import {
  ConflictException,
  Injectable,
  NotFoundException,
  Inject,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { BookingEntity } from './entity/booking.entity';
import { Repository } from 'typeorm';
import { GoodsEntity } from '../goods/entities/goods.entity';
import * as Redlock from 'redlock';
import { Redis } from 'ioredis';
import subRedis from 'ioredis';

@Injectable()
export class BookingService {
  private redisClient: Redis;
  private subscriber: Redis;
  private redlock: Redlock;

  constructor(
    @Inject('REDIS_CLIENT') redisClient: Redis,
    @InjectRepository(BookingEntity)
    private bookingRepository: Repository<BookingEntity>,
    @InjectRepository(GoodsEntity)
    private goodsRepository: Repository<GoodsEntity>,
  ) {
    this.redisClient = redisClient;
    this.subscriber = new subRedis(); // 구독을 위해 별도의 클라이언트 생성
    this.redlock = new Redlock([redisClient], {
      driftFactor: 0.01, // clock drift를 보상하기 위해 driftTime 지정에 사용되는 요소, 해당 값과 아래 ttl값을 곱하여 사용.
      retryCount: 10, // 에러 전까지 재시도 최대 횟수
      retryDelay: 200, // 각 시도간의 간격
      retryJitter: 200, // 재시도시 더해지는 되는 쵀대 시간(ms)
    });

    this.subscriber.subscribe('Ticket');
    this.subscriber.on('message', async (channel, message) => {
      const data = JSON.parse(message);
      try {
        const result = await this.createBooking(data.goodsId, data.userId);
        console.log(result);
      } catch (err) {
        console.error(err);
      }
    });
  }

  async publish(goodsId, userId) {
    const channel = 'Ticket';
    const reservationData = {
      goodsId,
      userId,
    };
    await this.redisClient.publish(channel, JSON.stringify(reservationData));
  }

  async createBooking(goodsId: number, userId: number) {
    let status;
    const lockResource = [`goodsId:${goodsId}:lock`]; // 락을 식별하는 고유 문자열
    const lock = await this.redlock.acquire(lockResource, 2000); // 2초 뒤에 자동 잠금해제

    const cachedBookingLimit = await this.getBookingLimitCount(goodsId); // 해당 goodsId의 bookingLimit을 레디스로부터 캐시해옴.
    try {
      let bookingData;

      // 캐시된게 없다면 DB에서 bookingLimit을 가져옴
      if (!cachedBookingLimit) {
        bookingData = await this.goodsRepository.findOne({
          where: { id: goodsId },
          select: { bookingLimit: true },
        });
      }
      const bookingLimit = bookingData.bookingLimit; // 예약 한도(postgreSQL)
      await this.setBookingLimitCount(goodsId, bookingLimit); // DB에서 가져온 bookingLimit을 레디스에 저장
      const bookingCount = await this.getBookingCount(goodsId); // 예약 총 갯수(레디스로부터)

      console.log('bookingCount:', bookingCount);
      console.log('bookingLimit:', bookingLimit);

      if (bookingCount < bookingLimit) {
        // 레디스에서 예약 수를 증가시킴.
        await this.redisClient.incr(`goodsId:${goodsId}`);
        await this.bookingRepository.insert({
          goodsId,
          userId,
        });
        // await this.bookingRepository.save(booking); // 트랜잭션은 save에서 발생.
        status = { success: true };
      } else {
        await this.redisClient.lpush(`waitlist:${goodsId}`, userId);
        status = { success: false, message: '예약 초과' };
      }
      await lock.unlock();
      return status;
    } catch (err) {
      console.error(err);
    }
  }

  // 레디스의 해당 goodsId의 누적 총 갯수를 가져옴
  async getBookingCount(goodsId: number): Promise<number> {
    const count = await this.redisClient.get(`goodsId:${goodsId}`);
    return +count;
  }

  // 레디스에서 해당 goodsId 의 bookingLimit 가져오기
  async getBookingLimitCount(goodsId: number): Promise<number> {
    const count = await this.redisClient.get(
      `bookingLimitOfGoodsId:${goodsId}`,
    );
    return +count;
  }

  // 레디스로 해당 goodsId 의 bookingLimit 저장하기
  async setBookingLimitCount(goodsId, bookingLimit: number): Promise<void> {
    await this.redisClient.set(
      `bookingLimitOfGoodsId:${goodsId}`,
      bookingLimit,
    );
    // return isCount;
  }

  async deleteBooking(goodsId: number, userId: number) {
    const deleteBooking = await this.bookingRepository.delete({
      userId,
      goodsId,
    });

    if (!deleteBooking)
      throw new NotFoundException({
        errorMessage: '예매정보를 찾을 수 없습니다.',
      });

    return deleteBooking.affected > 0;
  }
}

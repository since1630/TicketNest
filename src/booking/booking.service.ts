import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { BookingEntity } from './entity/booking.entity';
import { Repository } from 'typeorm';
import { GoodsEntity } from '../goods/entities/goods.entity';
import Redis from 'ioredis';

@Injectable()
export class BookingService {
  private readonly redisClient: Redis;
  constructor(
    @InjectRepository(BookingEntity)
    private bookingRepository: Repository<BookingEntity>,
    @InjectRepository(GoodsEntity)
    private goodsRepository: Repository<GoodsEntity>,
    @Inject('REDIS_CLIENT') redisClient: Redis,
  ) {
    this.redisClient = redisClient;
  }

  async createBooking(goodsId: number, userId: number) {
    // 1. goods에 예약되어 있는 Count 수 확인
    const cachedAccCount = await this.redisClient.get(`goodsId:${goodsId}`);
    let accCount: number;
    if (!cachedAccCount) {
      accCount = await this.bookingRepository.countBy({
        goodsId,
      }); // count를 레디스에 저장.
    } else {
      accCount = +cachedAccCount;
    }

    // 2. goods의 limit 확인
    const cachedBookingLimit = await this.redisClient.get(
      `bookingLimitOfGoodsId:${goodsId}`,
    );
    let bookingLimit: number;
    if (!cachedBookingLimit) {
      //! 기존 쿼리
      // const findLimit = await this.goodsRepository.findOne({
      //   where: { id: goodsId },
      //   select: { bookingLimit: true },
      // });

      //! 쿼리 빌더 적용
      const findLimit = await this.goodsRepository
        .createQueryBuilder('goods')
        .select('goods.bookingLimit')
        .where('goods.id = :id', { id: goodsId })
        .getOne();

      await this.redisClient.set(
        `bookingLimitOfGoodsId:${goodsId}`,
        findLimit.bookingLimit,
      );
      // 3. Count의 갯수가 bookingLimit보다 많을 경우
      bookingLimit = findLimit.bookingLimit;
    } else {
      bookingLimit = +cachedBookingLimit;
    }
    if (accCount > bookingLimit)
      throw new ConflictException({
        errorMessage: '남은 좌석이 없습니다.',
      });

    // 4. 예매 진행
    // 왜 save가 아닌 insert를 사용하였는가?
    // save() 메서드는 값이 없으면 insert 기능을 하여 데이터를 저장하고 값이 존재하면 덮어쓴다.
    // 그러고 저장된값을 select해서 리턴한다.
    // insert() 메서드는 값이 없으면 insert 기능을 하여 데이터를 저장하고 값이 존재하면 duplicate 오류를 발생시킨다.

    // //! 기존 insert 쿼리
    // await this.bookingRepository.insert({
    //   goodsId,
    //   userId,
    // });

    //! insert 쿼리 빌더 적용
    await this.bookingRepository
      .createQueryBuilder('booking')
      .insert()
      .into(BookingEntity)
      .values({
        goodsId,
        userId,
      })
      .execute();

    await this.redisClient.incr(`goodsId:${goodsId}`);

    // 5. 성공한 경우 Success:true
    return { Success: true };
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

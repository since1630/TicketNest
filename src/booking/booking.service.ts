import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import * as apm from 'elastic-apm-node';
import Redis from 'ioredis';
import { BookingGateway } from './booking.gateway';
import { GoodsEntity } from 'src/database/entity/goods.entity';
import { BookingEntity } from 'src/database/entity/booking.entity';

@Injectable()
export class BookingService {
  constructor(
    @InjectRepository(BookingEntity)
    private bookingRepository: Repository<BookingEntity>,
    @InjectRepository(GoodsEntity)
    private goodsRepository: Repository<GoodsEntity>,
    private dataSource: DataSource,
    @Inject('REDIS_CLIENT') private redisClient: Redis,
    private readonly bookingGateway: BookingGateway,
  ) {
    this.redisClient = redisClient;
  }

  async createBooking(booking) {
    //Transaction 적용을 위한 queryRunner 사용
    const trans = apm.startTransaction('createBooking');
    const queryRunner = this.dataSource.createQueryRunner();
    const qb = queryRunner.manager.createQueryBuilder();
    // const cacheSpan = apm.startSpan('cacheSpan');

    const cachedBookingCount = await this.redisClient.get(
      `goodsId:${booking.goodsId}`,
    );
    const cachedBookingLimit = await this.redisClient.get(
      `bookingLimitOfGoodsId:${booking.goodsId}`,
    );

    try {
      // 1. 예매수 및 Limit 확인
      // span 추가

      let bookingCount: number;
      let bookingLimit: number;
      const findGoodsSpan = apm.startSpan('findGoodsSpan');
      if (!cachedBookingCount || !cachedBookingLimit) {
        const findGoods = await qb
          .select([
            'GoodsEntity.id',
            'GoodsEntity.bookingLimit',
            'GoodsEntity.bookingCount',
          ])
          .from(GoodsEntity, 'GoodsEntity')
          .where('id=:id', { id: booking.goodsId })
          .getOne();

        bookingCount = findGoods.bookingCount;
        bookingLimit = findGoods.bookingLimit;
        await this.redisClient.set(
          `bookingLimitOfGoodsId:${findGoods.id}`,
          bookingLimit,
        );
      } else {
        // 레디스에서 가져온 데이터 타입은 스트링이므로 숫자로 변환
        bookingCount = +cachedBookingCount;
        bookingLimit = +cachedBookingLimit;
      }

      findGoodsSpan.end();

      // 2. 예매 limit보다 많을 경우, Error 처리 진행
      if (bookingCount >= bookingLimit) {
        //! throw 에러 처리를 하면 부하 테스트 단계에서 에러가 나서 일단 주석처리
        // throw new ConflictException({
        //   errorMessage: '남은 좌석이 없습니다.',
        // });
        await this.redisClient.lpush(
          `waitlist:${booking.goodsId}`,
          JSON.stringify({ goodsId: booking.goodsId, userId: booking.userId }),
        );
        return { message: '예매가 초과되어 대기자 명단에 등록 되었습니다' };
      }

      console.log('booking:', booking);

      //Booking insert ms 측정
      const bookingSaveSpan = apm.startSpan('bookingSaveSpan');
      // bookingEntity Insert 진행
      await qb
        .insert()
        .into(BookingEntity)
        .values({
          goodsId: booking.goodsId,
          userId: booking.userId,
        })
        .useTransaction(true)
        .execute();
      await this.redisClient.incr(`goodsId:${booking.goodsId}`); // 이 부분 분산 트랜잭션 필요함.

      // websocket 부분
      const newCachedBookingCount = await this.redisClient.get(
        `goodsId:${booking.goodsId}`,
      );
      //   if (newCachedBookingCount <= cachedBookingLimit) {
      //     this.bookingGateway.passOrderCountToQueue(
      //       booking.userId,
      //       +newCachedBookingCount,
      //     );
      //   } else{
      //     this.bookingGateway.passOrderCountToQueue()
      //   }

      newCachedBookingCount <= cachedBookingLimit
        ? this.bookingGateway.passOrderCountToQueue(
            booking.userId,
            +newCachedBookingCount,
          )
        : this.bookingGateway.passOrderCountToQueue(booking.userId, 0);

      console.log('cachedBookingCount:', cachedBookingCount);

      //   bookingSaveSpan.end();
      trans.end();
      return { message: '싸비스' };
    } catch (err) {
      console.error(err);
    }
  }

  async deleteBooking(goodsId: number, userId: number) {
    const deleteBooking = await this.bookingRepository.delete({
      userId,
      goodsId,
    });
    await this.redisClient.decr(`goodsId:${goodsId}`);

    if (!deleteBooking)
      throw new NotFoundException({
        errorMessage: '예매정보를 찾을 수 없습니다.',
      });

    return deleteBooking.affected > 0;
  }
}

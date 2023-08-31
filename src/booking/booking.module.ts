import { Module } from '@nestjs/common';
import { BookingProcessor } from './booking.controller';
import { BookingService } from './booking.service';
import { RedisModule } from 'src/redis/redis.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bull';

import { BookingEntity } from 'src/database/entity/booking.entity';
import { GoodsEntity } from 'src/database/entity/goods.entity';
import { BookingGateway } from './booking.gateway';

@Module({
  imports: [
    RedisModule,
    BullModule.registerQueue({ name: 'Ticket' }),
    TypeOrmModule.forFeature([BookingEntity, GoodsEntity]),
  ],
  // controllers: [BookingController],
  providers: [BookingService, BookingProcessor, BookingGateway],
})
export class BookingModule {}

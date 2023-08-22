import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { typeORMConfig } from './config/orm.config';
import { GoodsModule } from './goods/goods.module';
import { LoggingMiddleware } from './middlewares/logging.middleware';
import { BookingModule } from './booking/booking.module';
import { RedisModule } from './redis/redis.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    AuthModule,
    GoodsModule,
    BookingModule,
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useClass: typeORMConfig,
    }),
    RedisModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(LoggingMiddleware).forRoutes('*');
  }
}

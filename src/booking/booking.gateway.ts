import {
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server } from 'socket.io';
import { Socket } from 'socket.io';
import { config } from 'dotenv';
config();

@WebSocketGateway(+process.env.SOCKET_PORT, {
  cors: true,
  namespace: 'TicketNest-socket',
})
export class BookingGateway {
  @WebSocketServer()
  server: Server;

  passOrderCountToQueue(userId: string, order: number) {
    console.log(typeof +process.env.SOCKET_PORT);
    console.log('userId:', userId, 'order:', order);
    this.server
      // .to(userId)
      .to('common-room') // common-room 이란 룸에 메세지 보냄. 해당 room에 있는 유저들에게만 브로드 캐스팅 됨.
      .emit('waiting', `${userId}님의 대기 순서는 ${order}번 입니다`);
  }
  @SubscribeMessage('TicketNest-socket')
  async passOrderToClient(client: Socket, userId: string) {
    client.join('common-room');
  }
}

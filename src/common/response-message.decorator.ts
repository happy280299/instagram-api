import { SetMetadata } from '@nestjs/common';

export const RESPONSE_MESSAGE = 'response_message';

// Gắn message cho response thành công, VD: @ResponseMessage('Login success')
export const ResponseMessage = (message: string) =>
  SetMetadata(RESPONSE_MESSAGE, message);

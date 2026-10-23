import { All, Controller, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { toNodeHandler } from 'better-auth/node';
import { Public } from '../common/authorization/public.decorator';
import { auth } from './auth.config';

// Better Auth is the authentication boundary itself: sign-in has to work
// without a session, and its admin routes check the session and role
// internally, so the global guards step aside for this catch-all.
@Public()
@Controller()
export class AuthController {
  private readonly handler = toNodeHandler(auth);

  @All('api/auth/*')
  handleAuth(@Req() req: Request, @Res() res: Response): void {
    void this.handler(req, res);
  }
}

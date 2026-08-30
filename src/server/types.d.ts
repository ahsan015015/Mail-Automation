import type { UserDto } from '../../shared/types.js'

declare global {
  namespace Express {
    interface Request {
      user?: UserDto
    }
  }
}

export {}

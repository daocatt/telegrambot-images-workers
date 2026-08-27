import { EnvBindings } from '../bot/context'

export type ContextEnv = {
  Bindings: EnvBindings;
  Variables: {
    userId: string;
    isAdmin: boolean;
    isSuperAdmin: boolean;
  }
}

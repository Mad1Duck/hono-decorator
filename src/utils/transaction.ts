import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Stores the active transaction object for the current async call chain.
 * Populated by @Transaction — do not use directly.
 */
export const txStorage = new AsyncLocalStorage<unknown>();

/**
 * Returns the active transaction object if the current call is running
 * inside a @Transaction-decorated method, otherwise undefined.
 *
 * Use this in repositories to automatically participate in the caller's
 * transaction without being passed tx explicitly.
 *
 * @example
 * ```ts
 * import { useTransaction } from 'hono-forge';
 *
 * @Injectable()
 * class UserRepo {
 *   constructor(private db: AppDb) {}
 *
 *   // Falls back to this.db when called outside a transaction
 *   private get activeDb() {
 *     return useTransaction<AppDb>() ?? this.db;
 *   }
 *
 *   async findById(id: string) {
 *     return this.activeDb.select().from(users).where(eq(users.id, id));
 *   }
 * }
 *
 * // TransferService — no need to pass tx manually
 * @Injectable()
 * class TransferService {
 *   constructor(private userRepo: UserRepo, private walletRepo: WalletRepo) {}
 *
 *   @Transaction()
 *   async transfer(from: string, to: string, amount: number) {
 *     await this.userRepo.debit(from, amount);   // automatically uses tx
 *     await this.walletRepo.credit(to, amount);  // automatically uses tx
 *   }
 * }
 * ```
 */
export function useTransaction<TDb = unknown>(): TDb | undefined {
  return txStorage.getStore() as TDb | undefined;
}

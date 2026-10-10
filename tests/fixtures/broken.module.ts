import {
  Controller, Cron, Get, Injectable, Module, Public, RequestScoped,
} from '../../src';

// Missing dep — NotRegistered is not in providers.
@Injectable()
class MissingDep {
  ping() { return 'pong'; }
}

// Not in the module → Ghost.dep will be missing.
class Ghost {
  ping() { return 'boo'; }
}

@Injectable([Ghost])
class NeedsGhost {
  constructor(private ghost: Ghost) {}
}

@Controller('/dup')
@Injectable()
class DupA {
  @Get() @Public()
  a() { return 'a'; }
}

@Controller('/dup')
@Injectable()
class DupB {
  @Get() @Public()
  b() { return 'b'; }
}

@Injectable()
@RequestScoped()
class ScopedJobs {
  @Cron('definitely not cron')
  bad() {}
}

@Module({
  providers: [NeedsGhost, ScopedJobs],
  controllers: [DupA, DupB],
})
export class BrokenModule {}

import { ArgumentsHost, Catch, ExceptionFilter } from '@nestjs/common';
import { MissingTenantContextError, TenantMismatchError } from 'nestjs-tenant-guard';

/** The part of the Express response these filters use. */
interface JsonResponse {
  status(code: number): { json(body: unknown): void };
}

@Catch(TenantMismatchError)
export class TenantMismatchFilter implements ExceptionFilter {
  catch(_error: TenantMismatchError, host: ArgumentsHost): void {
    // 404, not 403: do not confirm that the id exists for another tenant.
    host.switchToHttp().getResponse<JsonResponse>().status(404).json({ message: 'Not found' });
  }
}

@Catch(MissingTenantContextError)
export class MissingTenantFilter implements ExceptionFilter {
  catch(_error: MissingTenantContextError, host: ArgumentsHost): void {
    host
      .switchToHttp()
      .getResponse<JsonResponse>()
      .status(401)
      .json({ message: 'Tenant required' });
  }
}

import { TenantRequest, TenantResolver } from './tenant-resolver.interface';

/** Header read by {@link HeaderTenantResolver} unless configured otherwise. */
export const DEFAULT_TENANT_HEADER = 'x-tenant-id';

/**
 * Default resolver: reads the tenant id from a request header.
 *
 * Only safe when the header is set by something you trust (API gateway, reverse proxy
 * that strips client-supplied values). If clients can send it directly, any client can
 * pick its own tenant. Resolve from a verified credential instead, see the README.
 */
export class HeaderTenantResolver implements TenantResolver {
  private readonly headerName: string;

  constructor(headerName: string = DEFAULT_TENANT_HEADER) {
    if (headerName.trim() === '') {
      throw new TypeError('HeaderTenantResolver: header name must be non-empty.');
    }
    // Node lower-cases incoming header names, so compare in lower case.
    this.headerName = headerName.toLowerCase();
  }

  /** Returns the trimmed header value, or `undefined` if it is absent, blank or repeated. */
  resolve(request: TenantRequest): string | undefined {
    const value = request.headers[this.headerName];
    // An array means the header was sent more than once. Picking one value would let a
    // client smuggle a second tenant past a proxy that only checks the first.
    if (typeof value !== 'string') {
      return undefined;
    }
    const tenantId = value.trim();
    return tenantId === '' ? undefined : tenantId;
  }
}

const BASE = (process.env.NEXT_PUBLIC_API_URL || '').replace(/\/$/, '');
export const apiUrl = (path: string) =>
  `${BASE}${path.startsWith('/') ? path : `/${path}`}`;

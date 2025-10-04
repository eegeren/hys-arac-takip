const BASE = process.env.NEXT_PUBLIC_API_URL || "";
export const apiUrl = (path: string) => `${BASE}${path}`;

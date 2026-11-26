export interface HealthPayload {
  ok: true;
  service: string;
}

export function getHealth(service = "api"): HealthPayload {
  return { ok: true, service };
}

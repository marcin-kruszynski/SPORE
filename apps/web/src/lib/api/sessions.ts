import { requestPayloadJson } from "./http.js";
import type { MissionMapApiSessionLive } from "../../types/mission-map.js";

const API_PREFIX = "/api/sessions";

export function getSessionLive(sessionId: string) {
  return requestPayloadJson<MissionMapApiSessionLive>(
    `${API_PREFIX}/${encodeURIComponent(sessionId)}/live`,
  );
}

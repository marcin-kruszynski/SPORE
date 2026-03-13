import { requestPayloadJson } from "./http.js";
import type {
  MissionMapApiSessionListEntry,
  MissionMapApiSessionLive,
} from "../../types/mission-map.js";

const API_PREFIX = "/api/sessions";

export function listSessions() {
  return requestPayloadJson<{ sessions?: MissionMapApiSessionListEntry[] }>(API_PREFIX).then(
    (payload) => payload.sessions ?? [],
  );
}

export function getSessionLive(sessionId: string) {
  return requestPayloadJson<MissionMapApiSessionLive>(
    `${API_PREFIX}/${encodeURIComponent(sessionId)}/live`,
  );
}

export function getSessionArtifact(
  sessionId: string,
  artifactName: string,
) {
  return requestPayloadJson<{
    content?: string | Record<string, unknown> | Array<Record<string, unknown>>;
    path?: string | null;
  }>(
    `${API_PREFIX}/${encodeURIComponent(sessionId)}/artifacts/${encodeURIComponent(
      artifactName,
    )}`,
  );
}

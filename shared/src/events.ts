import type { MapLocation, SessionQuestion, SessionStatus } from "./types.js";

export interface SeekerPosition {
    id: string;
    displayName: string;
    lat: number;
    lng: number;
}

/**
 * WebSocket events sent from the SERVER to clients.
 */
export type ServerToClientEvent =
    | {
          type: "question_added";
          question: SessionQuestion;
      }
    | {
          type: "question_answered";
          question: SessionQuestion;
      }
    | {
          type: "map_location_updated";
          mapLocation: MapLocation;
      }
    | {
          type: "session_status_changed";
          status: SessionStatus;
      }
    | {
          type: "participant_joined";
          participantId: string;
          role: "hider" | "seeker";
          displayName: string;
      }
    | {
          type: "participant_left";
          participantId: string;
      }
    | {
          /** Broadcast when a pending question's deadline passes (authoritative expiry signal). */
          type: "question_expired";
          questionId: string;
      }
    | {
          /** Sent immediately after connection to sync current state */
          type: "sync";
          questions: SessionQuestion[];
          mapLocation: MapLocation | null;
          status: SessionStatus;
          seekerCount: number;
          hiderConnected: boolean;
          /** All participants in the session (id, role, displayName) */
          participants: Array<{ id: string; role: "hider" | "seeker"; displayName: string }>;
      }
    | {
          /** Broadcast to hider only: current seeker positions */
          type: "seeker_positions";
          positions: SeekerPosition[];
      };

/**
 * WebSocket events sent from CLIENTS to the server.
 */
export type ClientToServerEvent =
    | {
          type: "ping";
      }
    | {
          /** Seeker sends a new question to the hider */
          type: "add_question";
          questionType: string;
          data: unknown;
      }
    | {
          /** Hider submits a GPS-computed answer */
          type: "answer_question";
          questionId: string;
          answerData: unknown;
      }
    | {
          /** Seeker or hider updates the map location */
          type: "update_map_location";
          mapLocation: MapLocation;
      }
    | {
          /** Seeker sets session to active (game starts) */
          type: "set_status";
          status: "active" | "finished";
      }
    | {
          /** Seeker sends their GPS position */
          type: "position_update";
          lat: number;
          lng: number;
      };

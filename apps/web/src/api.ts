import { createApi } from "@remix-hub/client-core";
import { session } from "./session.js";

const baseUrl = import.meta.env.VITE_API_BASE ?? "/api";

/** Web API client bound to the web session (base URL proxied to the API). */
export const api = createApi({ baseUrl, session });

export { ApiError } from "@remix-hub/client-core";

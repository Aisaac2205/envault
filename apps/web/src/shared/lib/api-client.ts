import axios from "axios";
import { APP_CONFIG } from "@/config";
import { endExpiredSession } from "./session-expired";

const apiClient = axios.create({
  baseURL: APP_CONFIG.apiBaseUrl,
  headers: {
    "Content-Type": "application/json",
  },
  withCredentials: true,
});

apiClient.interceptors.response.use(
  (response) => {
    if (response.data && typeof response.data === "object" && "data" in response.data && "timestamp" in response.data) {
      response.data = response.data.data;
    }
    return response;
  },
  (error) => {
    if (axios.isAxiosError(error) && error.response?.status === 401) {
      void endExpiredSession();
    }
    return Promise.reject(error);
  },
);

export default apiClient;

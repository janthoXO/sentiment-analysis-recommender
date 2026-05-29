import { Router } from "express";
import {
  type AuthenticatedRequest,
  authMiddleware,
} from "../auth/auth.router.js";
import type { NotificationService } from "./notification.service.js";

export function makeNotificationRouter({
  notificationService,
}: {
  notificationService: NotificationService;
}) {
  const notificationRouter = Router();

  notificationRouter.use(authMiddleware);

  notificationRouter.get("/stream", (req: AuthenticatedRequest, res) => {
    res.contentType("application/x-ndjson");
    res.setHeader("Transfer-Encoding", "chunked");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    const detach = notificationService.attach(req.user!.userId, (line) =>
      res.write(line)
    );

    req.on("close", () => {
      detach();
      res.end();
    });
  });

  return notificationRouter;
}

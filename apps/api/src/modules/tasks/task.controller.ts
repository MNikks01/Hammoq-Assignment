import type { Request, Response } from 'express';
import { requireAuth } from '../../middleware/authenticate';
import type { TaskService } from './task.service';

export function createTaskController(tasks: TaskService) {
  return {
    async list(req: Request, res: Response) {
      const { items, meta } = await tasks.list(requireAuth(req).userId, req.query);
      res.json({ data: items, meta });
    },
    async get(req: Request, res: Response) {
      res.json({ data: await tasks.get(requireAuth(req).userId, req.params) });
    },
    async create(req: Request, res: Response) {
      const task = await tasks.create(requireAuth(req).userId, req.body);
      res.status(201).location(`/api/v1/tasks/${task.id}`).json({ data: task });
    },
    async update(req: Request, res: Response) {
      res.json({ data: await tasks.update(requireAuth(req).userId, req.params, req.body) });
    },
    async updateStatus(req: Request, res: Response) {
      res.json({ data: await tasks.updateStatus(requireAuth(req).userId, req.params, req.body) });
    },
    async remove(req: Request, res: Response) {
      await tasks.remove(requireAuth(req).userId, req.params);
      res.status(204).end();
    },
  };
}

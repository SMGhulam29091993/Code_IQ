import { prisma } from "@codeiq/db";
import type { IProcessedEventRepository } from "./billing.types";

export class ProcessedEventRepository implements IProcessedEventRepository {
  async exists(eventId: string): Promise<boolean> {
    const row = await prisma.processedStripeEvent.findUnique({ where: { id: eventId } });
    return row !== null;
  }

  async create(eventId: string): Promise<void> {
    await prisma.processedStripeEvent.create({ data: { id: eventId } });
  }
}

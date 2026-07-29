import { Request, Response } from "express";
import { NlpSearchService } from "../services/nlp-search.service";

export class NlpSearchController {
  static async search(req: Request, res: Response): Promise<void> {
    const { q, type, minRating, maxPrice, language } = req.query;
    const userId = (req as any).user?.id;

    const results = await NlpSearchService.search(q as string, userId, {
      type: type as any,
      minRating: minRating ? parseFloat(minRating as string) : undefined,
      maxPrice: maxPrice ? parseFloat(maxPrice as string) : undefined,
      language: language as string,
    });

    await NlpSearchService.logSearch(userId, q as string, results.length);
    res.json({ success: true, data: results, total: results.length });
  }

  static async getSuggestions(req: Request, res: Response): Promise<void> {
    const { q } = req.query;
    const suggestions = await NlpSearchService.getSuggestions(q as string);
    res.json({ success: true, data: suggestions });
  }

  static async parseQuery(req: Request, res: Response): Promise<void> {
    const { q } = req.query;
    const parsed = NlpSearchService.parseQuery(q as string);
    res.json({ success: true, data: parsed });
  }
}

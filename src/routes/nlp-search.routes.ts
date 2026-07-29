import { Router } from "express";
import { NlpSearchController } from "../controllers/nlp-search.controller";

const router = Router();

router.get("/search/nlp", NlpSearchController.search);
router.get("/search/suggestions", NlpSearchController.getSuggestions);
router.get("/search/parse", NlpSearchController.parseQuery);

export default router;

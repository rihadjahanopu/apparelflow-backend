import { Router } from "express";
import { getRecipeById, listRecipes } from "../controllers/recipeController";
import { authenticateToken } from "../middleware/auth";

const router = Router();

// Recipes can be viewed by all authenticated staff
router.get("/", authenticateToken, listRecipes);
router.get("/:id", authenticateToken, getRecipeById);

export default router;

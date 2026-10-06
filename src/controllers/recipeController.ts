import { Request, Response } from 'express';
import { prisma } from '../db';

export const listRecipes = async (_req: Request, res: Response): Promise<void> => {
  try {
    const recipes = await prisma.recipe.findMany({
      include: {
        recipe_components: true,
      },
      orderBy: { id: 'asc' },
    });
    res.json({ recipes });
  } catch (error: any) {
    res.status(500).json({ error: 'INTERNAL_SERVER_ERROR', message: error.message });
  }
};

export const getRecipeById = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) {
      res.status(400).json({ error: 'BAD_REQUEST', message: 'Invalid recipe ID.' });
      return;
    }

    const recipe = await prisma.recipe.findUnique({
      where: { id },
      include: {
        recipe_components: true,
      },
    });

    if (!recipe) {
      res.status(404).json({ error: 'NOT_FOUND', message: 'Recipe not found.' });
      return;
    }

    res.json({ recipe });
  } catch (error: any) {
    res.status(500).json({ error: 'INTERNAL_SERVER_ERROR', message: error.message });
  }
};


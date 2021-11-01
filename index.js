const dotenv = require("dotenv");
const { Client } = require("@notionhq/client");

dotenv.config();
const notion = new Client({ auth: process.env.NOTION_KEY });

const RECIPIES_DATABASE_ID = "331f66db-fc60-4a6b-81af-ed5b890e64a9";
const GROCERIES_DATABASE_ID = "1682741a-88bc-4808-8ee5-f50a6c556964";

async function pollRecipes() {
  const recipes = await fetchRecipes();
  for (let recipe of recipes) {
    const recipeBlocks = [];
    let cursor = undefined;

    while (true) {
      const { results, next_cursor } = await notion.blocks.children.list({
        block_id: recipe.id,
      });
      recipeBlocks.push(...results);
      if (!next_cursor) {
        break;
      }
      cursor = next_cursor;
    }

    if (!recipeBlocks) {
      console.error(`No blocks found for recipe ${recipe.id}`);
      continue;
    }

    for (let block of recipeBlocks) {
      if (block.type === "to_do") {
        let todoLabel = block.to_do.text.reduce((l, t) => l + t.plain_text, "");
        if (todoLabel.includes("✨")) {
          if (block.to_do.checked) {
            await notion.blocks.update({
              block_id: block.id,
              to_do: {
                text: [{ text: { content: todoLabel + " (adding, will uncheck when finished...)" } }],
              },
            });
            await addIngredientsToGroceries(recipe, recipeBlocks);
            await notion.blocks.update({
              block_id: block.id,
              to_do: {
                checked: false,
                text: [{ text: { content: todoLabel } }],
              },
            });
          }
        }
      }
    }
  }

  // Poll again
  pollRecipes();
}

async function fetchRecipes() {
  const recipes = [];
  let cursor = undefined;

  while (true) {
    const { results, next_cursor } = await notion.databases.query({
      database_id: RECIPIES_DATABASE_ID,
      start_cursor: cursor,
    });
    recipes.push(...results);
    if (!next_cursor) {
      break;
    }
    cursor = next_cursor;
  }

  return recipes;
}

async function addIngredientsToGroceries(recipe, recipeBlocks) {
  let recipeTitle = recipe.properties.Name.title[0]?.plain_text;
  console.log(`Adding ${recipeTitle} ingredients to grocery list...`);

  for (let block of recipeBlocks) {
    if (
      block.type === "child_database" &&
      block.child_database.title === "Ingredients"
    ) {
      const ingredients = [];
      let cursor = undefined;

      while (true) {
        const { results, next_cursor } = await notion.databases.query({
          database_id: block.id,
          start_cursor: cursor,
        });
        ingredients.push(...results);
        if (!next_cursor) {
          break;
        }
        cursor = next_cursor;
      }

      for (let ingredient of ingredients) {
        if (ingredient.properties["Exclude?"].checkbox) continue;
        let title = ingredient.properties.Name.title;
        if (title.length !== 1) {
          console.error(`Ingredient title contained mulitple texts: ${title}`);
          continue;
        }
        title = title[0].plain_text;
        let quantity = ingredient.properties.Quantity.rich_text;
        if (quantity.length !== 1) {
          console.error(
            `Ingredient quantity did not contain one text: ${quantity}`
          );
          quantity = undefined;
        } else {
          quantity = quantity[0].plain_text;
        }
        let groceryItem = quantity ? `${title} (${quantity})` : title;
        await notion.pages.create({
          parent: { database_id: GROCERIES_DATABASE_ID },
          properties: {
            Name: { title: [{ text: { content: groceryItem } }] },
            Checked: { checkbox: false },
          },
        });
      }
    }
  }

  console.log(`Finished adding ${recipeTitle} ingredients to grocery list.`);
}

pollRecipes();

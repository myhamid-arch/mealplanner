import type { Metadata } from "next";
import { SignedOut } from "../../../../components/plan/signed-out";
import { RecipeScreen } from "../../../../components/recipe/recipe-page";

export const metadata: Metadata = { title: "Recipe" };
export const dynamic = "force-dynamic";

/** Recipe page (UX-4, R2-UX-3; RecipePage.dc.html). */
export default async function RecipePage({
  params,
}: {
  readonly params: Promise<{ dishId: string }>;
}) {
  const { dishId } = await params;
  return (
    <SignedOut what="This recipe">
      <RecipeScreen id={dishId} />
    </SignedOut>
  );
}

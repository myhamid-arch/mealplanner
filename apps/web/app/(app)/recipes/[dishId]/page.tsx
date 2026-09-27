import type { Metadata } from "next";
import { SignedOut } from "../../../../components/plan/signed-out";
import { RecipeScreen } from "../../../../components/recipe/recipe-page";

export const metadata: Metadata = { title: "Recipe" };
export const dynamic = "force-dynamic";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const KEY = /^[a-z0-9_]{1,40}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * Recipe page (UX-4, R2-UX-3; RecipePage.dc.html). `?date=YYYY-MM-DD&slot=<slot key>` (and
 * `&member=<member id>` for an individual meal) adds "Use for <day> <slot>" (R-58, SPEC-Q-5).
 */
export default async function RecipePage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ dishId: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { dishId } = await params;
  const query = await searchParams;
  const date = one(query.date);
  const slot = one(query.slot);
  const member = one(query.member);
  const useFor =
    date !== undefined && slot !== undefined && ISO_DATE.test(date) && KEY.test(slot)
      ? { date, slot, member: member !== undefined && UUID.test(member) ? member : null }
      : null;
  return (
    <SignedOut what="This recipe">
      <RecipeScreen id={dishId} useFor={useFor} />
    </SignedOut>
  );
}

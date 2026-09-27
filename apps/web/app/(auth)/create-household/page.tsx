import type { Metadata } from "next";
import { AuthCentered } from "../../../components/admin/auth-shell";
import { CreateHouseholdForm } from "./create-household-form";

export const metadata: Metadata = { title: "Create a household" };

/** CreateHousehold.dc.html (ARC-6): signing up creates the user and a household, as its admin. */
export default function CreateHouseholdPage() {
  return (
    <AuthCentered>
      <CreateHouseholdForm />
    </AuthCentered>
  );
}

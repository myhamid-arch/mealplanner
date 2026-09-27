// Every `/api/v1` endpoint (ARC-5) with its ARC-6 role row. The route files, the typed client, the
// OpenAPI document and the G1 contract and authorisation tests are all built from this list.
// Writes to household configuration go through `POST /change-sets` (leaf-1.4.1 SPEC-Q-1).
import { z } from "zod";
import {
  EXCLUSION_KINDS,
  HOUSEHOLD_ROLES,
  INGREDIENT_CATEGORIES,
  PROPOSAL_STATUSES,
  REVIEW_TARGET_TYPES,
} from "@mealplanner/core/types";
import { ChangeSetRef, Id, IsoDate, JobRef, Ok, Timestamp } from "./common.js";
import * as d from "./dto.js";
import { ADMIN, ADMIN_KITCHEN, ADMIN_MEMBER, ALL_ROLES, endpoint } from "./endpoint.js";

const V = "/api/v1";
const byId = z.object({ id: Id });
const byUser = z.object({ userId: Id });
const list = <T extends z.ZodType>(key: string, item: T) => z.object({ [key]: z.array(item) });

// Auth, account --------------------------------------------------------------------------------

export const signup = endpoint({
  id: "auth.signup",
  method: "POST",
  path: `${V}/signup`,
  summary: "Sign up: creates the user and a household with the user as admin (ARC-6)",
  tag: "auth",
  auth: "public",
  body: d.SignupBody,
  status: 201,
  response: d.SessionDto,
  errors: [409],
});

export const me = endpoint({
  id: "auth.me",
  method: "GET",
  path: `${V}/me`,
  summary: "The signed-in user, memberships and platform role",
  tag: "auth",
  auth: "session",
  response: d.MeDto,
});

export const accountGet = endpoint({
  id: "account.get",
  method: "GET",
  path: `${V}/account`,
  summary: "Profile, two-step sign-in state and notification preferences (R2-ADM-5)",
  tag: "account",
  auth: "session",
  response: d.AccountDto,
});

export const accountUpdate = endpoint({
  id: "account.update",
  method: "PATCH",
  path: `${V}/account`,
  summary: "Change the display name",
  tag: "account",
  auth: "session",
  body: z.object({ name: z.string().trim().min(1).max(100) }).strict(),
  response: d.UserDto,
});

export const accountPassword = endpoint({
  id: "account.password",
  method: "POST",
  path: `${V}/account/password`,
  summary: "Change password; other sessions are signed out",
  tag: "account",
  auth: "session",
  body: z.object({ currentPassword: z.string().min(1).max(128), newPassword: d.Password }).strict(),
  response: Ok,
});

export const accountSessions = endpoint({
  id: "account.sessions",
  method: "GET",
  path: `${V}/account/sessions`,
  summary: "Active sessions (R2-ADM-5)",
  tag: "account",
  auth: "session",
  response: list("sessions", d.SessionRowDto),
});

export const accountSessionRevoke = endpoint({
  id: "account.sessionRevoke",
  method: "DELETE",
  path: `${V}/account/sessions/{id}`,
  summary: "Sign out one session",
  tag: "account",
  auth: "session",
  params: byId,
  status: 204,
});

export const accountTotpEnable = endpoint({
  id: "account.totpEnable",
  method: "POST",
  path: `${V}/account/totp/enable`,
  summary: "Start TOTP setup: returns the otpauth URI and backup codes",
  tag: "account",
  auth: "session",
  body: z.object({ password: z.string().min(1).max(128) }).strict(),
  response: d.TotpEnableDto,
});

export const accountTotpVerify = endpoint({
  id: "account.totpVerify",
  method: "POST",
  path: `${V}/account/totp/verify`,
  summary:
    "Confirm TOTP setup with a current code; the session is replaced, and the new bearer token returned",
  tag: "account",
  auth: "session",
  body: z.object({ code: z.string().regex(/^\d{6}$/) }).strict(),
  response: z.object({
    twoFactorEnabled: z.literal(true),
    /** The replacement session's bearer token (null when the session was kept). */
    token: z.string().nullable(),
  }),
});

export const accountTotpDisable = endpoint({
  id: "account.totpDisable",
  method: "POST",
  path: `${V}/account/totp/disable`,
  summary: "Turn off two-step sign-in (refused while a household requires it for its admins)",
  tag: "account",
  auth: "session",
  body: z.object({ password: z.string().min(1).max(128) }).strict(),
  response: z.object({ twoFactorEnabled: z.literal(false) }),
  errors: [409],
});

export const accountNotifications = endpoint({
  id: "account.notifications",
  method: "GET",
  path: `${V}/account/notifications`,
  summary: "Notification preferences",
  tag: "account",
  auth: "session",
  response: list("notifications", d.NotificationPrefDto),
});

export const accountNotificationsSet = endpoint({
  id: "account.notificationsSet",
  method: "PUT",
  path: `${V}/account/notifications`,
  summary: "Replace notification preferences",
  tag: "account",
  auth: "session",
  body: z.object({ notifications: z.array(d.NotificationPrefDto).max(50) }).strict(),
  response: list("notifications", d.NotificationPrefDto),
});

export const accountDelete = endpoint({
  id: "account.delete",
  method: "DELETE",
  path: `${V}/account`,
  summary: "Delete my account (refused for a household's last admin)",
  tag: "account",
  auth: "session",
  body: z.object({ password: z.string().min(1).max(128) }).strict(),
  status: 204,
  errors: [409],
});

// Invites, people & access (R2-ADM-2 … 4) ------------------------------------------------------

export const invitesList = endpoint({
  id: "invites.list",
  method: "GET",
  path: `${V}/invites`,
  summary: "The household's invites",
  tag: "access",
  auth: "household",
  roles: ADMIN,
  response: list("invites", d.InviteDto),
});

export const invitesCreate = endpoint({
  id: "invites.create",
  method: "POST",
  path: `${V}/invites`,
  summary: "Create an invite (single use; 24 h, 7 d or 30 d)",
  tag: "access",
  auth: "household",
  roles: ADMIN,
  body: d.InviteCreateBody,
  status: 201,
  response: d.InviteDto,
  errors: [503],
});

export const invitesResend = endpoint({
  id: "invites.resend",
  method: "POST",
  path: `${V}/invites/{id}/resend`,
  summary: "Replace an invite with a fresh code (the old one is revoked)",
  tag: "access",
  auth: "household",
  roles: ADMIN,
  params: byId,
  body: d.InviteResendBody,
  status: 201,
  response: d.InviteDto,
  errors: [409, 503],
});

export const invitesRevoke = endpoint({
  id: "invites.revoke",
  method: "POST",
  path: `${V}/invites/{id}/revoke`,
  summary: "Revoke an invite",
  tag: "access",
  auth: "household",
  roles: ADMIN,
  params: byId,
  response: d.InviteDto,
  errors: [409],
});

export const invitesLookup = endpoint({
  id: "invites.lookup",
  method: "GET",
  path: `${V}/invites/code/{code}`,
  summary: "What an open invite is for (household name, role)",
  tag: "access",
  auth: "public",
  params: z.object({ code: z.string().length(10) }),
  response: d.InviteLookupDto,
  errors: [410],
});

export const invitesAccept = endpoint({
  id: "invites.accept",
  method: "POST",
  path: `${V}/invites/accept`,
  summary: "Accept an invite (signing up, or as the signed-in user)",
  tag: "access",
  auth: "optional",
  body: d.InviteAcceptBody,
  response: d.InviteAcceptDto,
  errors: [409, 410],
});

export const accessList = endpoint({
  id: "access.list",
  method: "GET",
  path: `${V}/access`,
  summary: "Logins with role, status and last activity; members without a login",
  tag: "access",
  auth: "household",
  roles: ADMIN,
  response: d.AccessListDto,
});

export const accessRole = endpoint({
  id: "access.role",
  method: "POST",
  path: `${V}/access/{userId}/role`,
  summary: "Change a login's role (the last admin cannot be demoted)",
  tag: "access",
  auth: "household",
  roles: ADMIN,
  params: byUser,
  body: z.object({ role: z.enum(HOUSEHOLD_ROLES) }).strict(),
  response: ChangeSetRef,
  errors: [409, 422],
});

export const accessBlock = endpoint({
  id: "access.block",
  method: "POST",
  path: `${V}/access/{userId}/block`,
  summary: "Block a login: all its sessions end now; sign-in is refused (R2-ADM-4)",
  tag: "access",
  auth: "household",
  roles: ADMIN,
  params: byUser,
  body: z.object({ reason: d.Reason.optional() }).strict(),
  response: d.AccessChangeDto,
  errors: [409, 422],
});

export const accessUnblock = endpoint({
  id: "access.unblock",
  method: "POST",
  path: `${V}/access/{userId}/unblock`,
  summary: "Unblock a login",
  tag: "access",
  auth: "household",
  roles: ADMIN,
  params: byUser,
  response: ChangeSetRef,
  errors: [422],
});

export const accessRemove = endpoint({
  id: "access.remove",
  method: "POST",
  path: `${V}/access/{userId}/remove`,
  summary: "Remove a login from the household, optionally archiving its member",
  tag: "access",
  auth: "household",
  roles: ADMIN,
  params: byUser,
  body: z
    .object({ reason: d.Reason.optional(), archiveMember: z.boolean().default(false) })
    .strict(),
  response: d.AccessChangeDto,
  errors: [409, 422],
});

export const accessLinkMember = endpoint({
  id: "access.linkMember",
  method: "POST",
  path: `${V}/access/{userId}/link-member`,
  summary: "Link a login to the member it eats as (null unlinks)",
  tag: "access",
  auth: "household",
  roles: ADMIN,
  params: byUser,
  body: z.object({ memberId: Id.nullable() }).strict(),
  response: ChangeSetRef,
  errors: [422],
});

export const accessPasswordReset = endpoint({
  id: "access.passwordReset",
  method: "POST",
  path: `${V}/access/{userId}/password-reset`,
  summary: "Email the login a password-reset link",
  tag: "access",
  auth: "household",
  roles: ADMIN,
  params: byUser,
  status: 202,
  response: Ok,
  errors: [503],
});

export const accessSignOutAll = endpoint({
  id: "access.signOutAll",
  method: "POST",
  path: `${V}/access/{userId}/sign-out-all`,
  summary: "Sign a login out of all devices",
  tag: "access",
  auth: "household",
  roles: ADMIN,
  params: byUser,
  response: z.object({ sessionsRevoked: z.number().int() }),
});

// Household (R2-ADM-6) ---------------------------------------------------------------------------

export const householdGet = endpoint({
  id: "households.current",
  method: "GET",
  path: `${V}/households/current`,
  summary: "The selected household and its settings",
  tag: "household",
  auth: "household",
  roles: ALL_ROLES,
  response: d.HouseholdDto,
});

export const householdExport = endpoint({
  id: "households.export",
  method: "GET",
  path: `${V}/households/current/export`,
  summary: "Every household table as JSON (no auth secrets)",
  tag: "household",
  auth: "household",
  roles: ADMIN,
  response: z.object({
    exportedAt: Timestamp,
    householdId: Id,
    tables: z.record(z.string(), z.array(z.record(z.string(), z.json()))),
  }),
});

export const householdExportCsv = endpoint({
  id: "households.exportCsv",
  method: "GET",
  path: `${V}/households/current/export/{table}`,
  summary: "One household table as CSV (RFC 4180)",
  tag: "household",
  auth: "household",
  roles: ADMIN,
  params: z.object({ table: z.string().regex(/^[a-z_]+$/) }),
  format: "csv",
});

export const householdDeletion = endpoint({
  id: "households.deletion",
  method: "GET",
  path: `${V}/households/current/deletion`,
  summary: "The deletion request, if any",
  tag: "household",
  auth: "household",
  roles: ADMIN,
  response: d.DeletionDto,
});

export const householdDeletionRequest = endpoint({
  id: "households.deletionRequest",
  method: "POST",
  path: `${V}/households/current/deletion`,
  summary: "Request deletion: a 14-day grace, after a second admin confirms when there is one",
  tag: "household",
  auth: "household",
  roles: ADMIN,
  response: d.DeletionDto,
  errors: [409],
});

export const householdDeletionConfirm = endpoint({
  id: "households.deletionConfirm",
  method: "POST",
  path: `${V}/households/current/deletion/confirm`,
  summary: "Second admin confirms the deletion request",
  tag: "household",
  auth: "household",
  roles: ADMIN,
  response: d.DeletionDto,
  errors: [409],
});

export const householdDeletionCancel = endpoint({
  id: "households.deletionCancel",
  method: "DELETE",
  path: `${V}/households/current/deletion`,
  summary: "Cancel the deletion request (any admin)",
  tag: "household",
  auth: "household",
  roles: ADMIN,
  response: d.DeletionDto,
});

export const supportGrantsList = endpoint({
  id: "supportGrants.list",
  method: "GET",
  path: `${V}/households/current/support-grants`,
  summary: "Support access grants (R2-ADM-8)",
  tag: "household",
  auth: "household",
  roles: ADMIN,
  response: list("grants", d.SupportGrantDto),
});

export const supportGrantsCreate = endpoint({
  id: "supportGrants.create",
  method: "POST",
  path: `${V}/households/current/support-grants`,
  summary: "Grant a platform operator time-limited access to this household's data",
  tag: "household",
  auth: "household",
  roles: ADMIN,
  body: z.object({ operatorEmail: z.email(), hours: z.number().int().min(1).max(168) }).strict(),
  status: 201,
  response: d.SupportGrantDto,
  errors: [422],
});

export const supportGrantsRevoke = endpoint({
  id: "supportGrants.revoke",
  method: "POST",
  path: `${V}/households/current/support-grants/{id}/revoke`,
  summary: "Revoke a support grant",
  tag: "household",
  auth: "household",
  roles: ADMIN,
  params: byId,
  response: d.SupportGrantDto,
  errors: [422],
});

// Configuration reads ------------------------------------------------------------------------------

export const membersList = endpoint({
  id: "members.list",
  method: "GET",
  path: `${V}/members`,
  summary: "Members (names for kitchen only when the household allows it)",
  tag: "config",
  auth: "household",
  roles: ALL_ROLES,
  response: list("members", d.MemberDto),
});

export const membersGet = endpoint({
  id: "members.get",
  method: "GET",
  path: `${V}/members/{id}`,
  summary: "A member with targets and tolerance (admin, or the member's own login)",
  tag: "config",
  auth: "household",
  roles: ADMIN_MEMBER,
  params: byId,
  response: d.MemberDetailDto,
});

export const targetsList = endpoint({
  id: "targets.list",
  method: "GET",
  path: `${V}/targets`,
  summary: "Target profiles and tolerances (a member sees only their own)",
  tag: "config",
  auth: "household",
  roles: ADMIN_MEMBER,
  response: d.TargetsDto,
});

export const slotsList = endpoint({
  id: "slots.list",
  method: "GET",
  path: `${V}/slots`,
  summary: "Meal slots",
  tag: "config",
  auth: "household",
  roles: ALL_ROLES,
  response: list("slots", d.SlotDto),
});

export const schedulesGet = endpoint({
  id: "schedules.get",
  method: "GET",
  path: `${V}/schedules`,
  summary: "Attendance, training, day overrides, meal splits and per-slot targets",
  tag: "config",
  auth: "household",
  roles: ADMIN,
  response: d.SchedulesDto,
});

export const weightsGet = endpoint({
  id: "weights.get",
  method: "GET",
  path: `${V}/weights`,
  summary: "Planning weights",
  tag: "config",
  auth: "household",
  roles: ADMIN,
  response: d.WeightsDto,
});

export const presetsList = endpoint({
  id: "presets.list",
  method: "GET",
  path: `${V}/presets`,
  summary: "Weight presets",
  tag: "config",
  auth: "household",
  roles: ADMIN,
  response: list("presets", d.PresetDto),
});

export const exclusionsList = endpoint({
  id: "exclusions.list",
  method: "GET",
  path: `${V}/exclusions`,
  summary: "Exclusions (a member sees household-level ones and their own)",
  tag: "config",
  auth: "household",
  roles: ADMIN_MEMBER,
  query: z.object({ kind: z.enum(EXCLUSION_KINDS).optional() }),
  response: list("exclusions", d.ExclusionDto),
});

export const frequencyRulesList = endpoint({
  id: "frequencyRules.list",
  method: "GET",
  path: `${V}/frequency-rules`,
  summary: "Frequency rules",
  tag: "config",
  auth: "household",
  roles: ADMIN,
  response: list("rules", d.FrequencyRuleDto),
});

export const mealOverridesList = endpoint({
  id: "mealOverrides.list",
  method: "GET",
  path: `${V}/meal-overrides`,
  summary: "One-off meal overrides (R2-MEAL-2)",
  tag: "config",
  auth: "household",
  roles: ADMIN,
  query: z.object({ from: IsoDate.optional(), to: IsoDate.optional() }),
  response: list("overrides", d.MealOverrideDto),
});

// Catalogue --------------------------------------------------------------------------------------

export const dishesList = endpoint({
  id: "dishes.list",
  method: "GET",
  path: `${V}/dishes`,
  summary: "Recipe library: the seed library and the household's dishes",
  tag: "catalogue",
  auth: "household",
  roles: ALL_ROLES,
  query: z.object({
    q: z.string().max(100).optional(),
    cuisine: z.string().max(60).optional(),
    slot: z.string().max(64).optional(),
    status: z.enum(["draft", "active", "retired"]).optional(),
  }),
  response: list("dishes", d.DishSummaryDto),
});

export const dishesGet = endpoint({
  id: "dishes.get",
  method: "GET",
  path: `${V}/dishes/{id}`,
  summary: "A recipe with components, variants, ingredients and per-100 g nutrition",
  tag: "catalogue",
  auth: "household",
  roles: ALL_ROLES,
  params: byId,
  response: d.DishDto,
});

export const ingredientsList = endpoint({
  id: "ingredients.list",
  method: "GET",
  path: `${V}/ingredients`,
  summary: "Catalogue and household ingredients",
  tag: "catalogue",
  auth: "household",
  roles: ALL_ROLES,
  query: z.object({
    q: z.string().max(100).optional(),
    category: z.enum(INGREDIENT_CATEGORIES).optional(),
    limit: z.coerce.number().int().min(1).max(500).default(100),
  }),
  response: list("ingredients", d.IngredientDto),
});

export const ingredientsGet = endpoint({
  id: "ingredients.get",
  method: "GET",
  path: `${V}/ingredients/{id}`,
  summary: "An ingredient",
  tag: "catalogue",
  auth: "household",
  roles: ALL_ROLES,
  params: byId,
  response: d.IngredientDto,
});

export const cuisinesList = endpoint({
  id: "cuisines.list",
  method: "GET",
  path: `${V}/cuisines`,
  summary: "Cuisines",
  tag: "catalogue",
  auth: "household",
  roles: ALL_ROLES,
  response: list("cuisines", d.CuisineDto),
});

export const methodsList = endpoint({
  id: "methods.list",
  method: "GET",
  path: `${V}/methods`,
  summary: "Preparation methods",
  tag: "catalogue",
  auth: "household",
  roles: ALL_ROLES,
  response: list("methods", d.MethodDto),
});

// Plans ------------------------------------------------------------------------------------------

export const plansList = endpoint({
  id: "plans.list",
  method: "GET",
  path: `${V}/plans`,
  summary: "Plan days with meals and the plates the viewer may see (ARC-6)",
  tag: "plans",
  auth: "household",
  roles: ALL_ROLES,
  query: z.object({ from: IsoDate, to: IsoDate }),
  response: d.PlansDto,
});

export const plansGenerate = endpoint({
  id: "plans.generate",
  method: "POST",
  path: `${V}/plans/generate`,
  summary: "Queue plan generation (progress at /jobs/{id}/events)",
  tag: "plans",
  auth: "household",
  roles: ADMIN,
  body: d.GenerateBody,
  status: 202,
  response: JobRef,
});

export const planMealsGet = endpoint({
  id: "planMeals.get",
  method: "GET",
  path: `${V}/plan-meals/{id}`,
  summary: "One meal with the plates the viewer may see",
  tag: "plans",
  auth: "household",
  roles: ALL_ROLES,
  params: byId,
  response: d.PlanMealDto,
});

export const planMealsAlternatives = endpoint({
  id: "planMeals.alternatives",
  method: "GET",
  path: `${V}/plan-meals/{id}/alternatives`,
  summary: "Top 5 alternatives with score breakdowns (PLN-13)",
  tag: "plans",
  auth: "household",
  roles: ADMIN,
  params: byId,
  response: d.AlternativesDto,
});

export const planMealsSwap = endpoint({
  id: "planMeals.swap",
  method: "POST",
  path: `${V}/plan-meals/{id}/swap`,
  summary: "Swap the dish; plates are re-solved (PLN-13)",
  tag: "plans",
  auth: "household",
  roles: ADMIN,
  params: byId,
  body: d.SwapBody,
  response: z.object({ changeSetId: Id, meal: d.PlanMealDto }),
  errors: [409, 422],
});

export const planMealsLock = endpoint({
  id: "planMeals.lock",
  method: "POST",
  path: `${V}/plan-meals/{id}/lock`,
  summary: "Lock a meal: regeneration keeps it",
  tag: "plans",
  auth: "household",
  roles: ADMIN,
  params: byId,
  response: ChangeSetRef,
  errors: [422],
});

export const planMealsUnlock = endpoint({
  id: "planMeals.unlock",
  method: "POST",
  path: `${V}/plan-meals/{id}/unlock`,
  summary: "Unlock a meal",
  tag: "plans",
  auth: "household",
  roles: ADMIN,
  params: byId,
  response: ChangeSetRef,
  errors: [422],
});

export const platesGet = endpoint({
  id: "plates.get",
  method: "GET",
  path: `${V}/plates/{id}`,
  summary: "One plate (own; others' when the household allows it)",
  tag: "plans",
  auth: "household",
  roles: ADMIN_MEMBER,
  params: byId,
  response: d.PlateDto,
});

export const platesOverride = endpoint({
  id: "plates.override",
  method: "POST",
  path: `${V}/plates/{id}/override`,
  summary: "Override a plate's grams; the plate is re-scored against its target (PLN-13)",
  tag: "plans",
  auth: "household",
  roles: ADMIN,
  params: byId,
  body: d.PlateOverrideBody,
  response: z.object({ changeSetId: Id, plate: d.PlateDto }),
  errors: [422],
});

export const cookSheetsGet = endpoint({
  id: "cookSheets.get",
  method: "GET",
  path: `${V}/cook-sheets/{date}`,
  summary: "The day's cook sheet (PLN-14)",
  tag: "plans",
  auth: "household",
  roles: ALL_ROLES,
  params: z.object({ date: IsoDate }),
  response: d.CookSheetDto,
});

export const cookSheetsFlag = endpoint({
  id: "cookSheets.flag",
  method: "POST",
  path: `${V}/cook-sheets/{date}/flags`,
  summary:
    "Kitchen flag: ingredient unavailable (substitutes and re-solves) or recipe unclear (R2-UX-1)",
  tag: "plans",
  auth: "household",
  roles: ADMIN_KITCHEN,
  params: z.object({ date: IsoDate }),
  body: d.KitchenFlagBody,
  status: 202,
  response: d.KitchenFlagDto,
  errors: [422],
});

// Reviews, preferences ---------------------------------------------------------------------------

export const reviewsList = endpoint({
  id: "reviews.list",
  method: "GET",
  path: `${V}/reviews`,
  summary: "Review feed",
  tag: "reviews",
  auth: "household",
  roles: ALL_ROLES,
  query: z.object({
    targetType: z.enum(REVIEW_TARGET_TYPES).optional(),
    targetId: z.string().max(200).optional(),
    memberId: Id.optional(),
    parentId: Id.optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
  }),
  response: list("reviews", d.ReviewDto),
});

export const reviewsCreate = endpoint({
  id: "reviews.create",
  method: "POST",
  path: `${V}/reviews`,
  summary: "Write a review (kitchen: kitchen tags only)",
  tag: "reviews",
  auth: "household",
  roles: ALL_ROLES,
  body: d.ReviewCreateBody,
  status: 201,
  response: d.ReviewDto,
  errors: [422],
});

export const reviewsEdit = endpoint({
  id: "reviews.edit",
  method: "PATCH",
  path: `${V}/reviews/{id}`,
  summary: "Edit your own review within 24 h (edits are kept)",
  tag: "reviews",
  auth: "household",
  roles: ALL_ROLES,
  params: byId,
  body: d.ReviewEditBody,
  response: d.ReviewDto,
  errors: [409, 422],
});

export const reviewsReply = endpoint({
  id: "reviews.reply",
  method: "POST",
  path: `${V}/reviews/{id}/replies`,
  summary: "Reply to a review",
  tag: "reviews",
  auth: "household",
  roles: ADMIN_MEMBER,
  params: byId,
  body: d.ReplyBody,
  status: 201,
  response: d.ReviewDto,
  errors: [422],
});

export const reviewsReact = endpoint({
  id: "reviews.react",
  method: "POST",
  path: `${V}/reviews/{id}/reactions`,
  summary: "React to a review (agree, disagree, helpful)",
  tag: "reviews",
  auth: "household",
  roles: ADMIN_MEMBER,
  params: byId,
  body: d.ReactionBody,
  response: Ok,
  errors: [422],
});

export const reviewsRevisions = endpoint({
  id: "reviews.revisions",
  method: "GET",
  path: `${V}/reviews/{id}/revisions`,
  summary: "Earlier versions of a review",
  tag: "reviews",
  auth: "household",
  roles: ALL_ROLES,
  params: byId,
  response: list("revisions", d.ReviewRevisionDto),
});

export const preferencesList = endpoint({
  id: "preferences.list",
  method: "GET",
  path: `${V}/preferences`,
  summary: "Preferences (a member sees household-level ones and their own)",
  tag: "reviews",
  auth: "household",
  roles: ADMIN_MEMBER,
  query: z.object({ memberId: Id.optional() }),
  response: list("preferences", d.PreferenceDto),
});

export const preferencesSet = endpoint({
  id: "preferences.set",
  method: "PUT",
  path: `${V}/preferences`,
  summary: "Set a taste preference (a member: only their own)",
  tag: "reviews",
  auth: "household",
  roles: ADMIN_MEMBER,
  body: d.PreferenceSetBody,
  response: ChangeSetRef,
  errors: [422],
});

export const preferencesReset = endpoint({
  id: "preferences.reset",
  method: "POST",
  path: `${V}/preferences/reset`,
  summary: "Reset a preference to learned/automatic (a member: only their own)",
  tag: "reviews",
  auth: "household",
  roles: ADMIN_MEMBER,
  body: d.PreferenceResetBody,
  response: ChangeSetRef,
  errors: [422],
});

// Detail levels (R2-DL-1; leaf 1.4.3, BLD-8 R-47) -----------------------------------------------

export const detailLevelsList = endpoint({
  id: "detailLevels.list",
  method: "GET",
  path: `${V}/detail-levels`,
  summary: "Detail level per (member, section) (a member sees only their own)",
  tag: "config",
  auth: "household",
  roles: ADMIN_MEMBER,
  response: list("levels", d.DetailLevelDto),
});

export const detailLevelsSet = endpoint({
  id: "detailLevels.set",
  method: "PUT",
  path: `${V}/detail-levels`,
  summary: "Set the detail level of one section (a member: only their own taste section)",
  tag: "config",
  auth: "household",
  roles: ADMIN_MEMBER,
  body: d.DetailLevelSetBody,
  response: d.DetailLevelDto,
});

// Proposals, change log, insights ----------------------------------------------------------------

export const proposalsList = endpoint({
  id: "proposals.list",
  method: "GET",
  path: `${V}/proposals`,
  summary: "Proposals",
  tag: "changes",
  auth: "household",
  roles: ADMIN,
  query: z.object({ status: z.enum(PROPOSAL_STATUSES).optional() }),
  response: list("proposals", d.ProposalDto),
});

export const proposalsAccept = endpoint({
  id: "proposals.accept",
  method: "POST",
  path: `${V}/proposals/{id}/accept`,
  summary: "Accept a proposal: its ops are applied as one change set",
  tag: "changes",
  auth: "household",
  roles: ADMIN,
  params: byId,
  response: z.object({ proposal: d.ProposalDto, changeSetId: Id }),
  errors: [409, 422],
});

export const proposalsReject = endpoint({
  id: "proposals.reject",
  method: "POST",
  path: `${V}/proposals/{id}/reject`,
  summary: "Reject a proposal with an optional reason",
  tag: "changes",
  auth: "household",
  roles: ADMIN,
  params: byId,
  body: d.RejectBody,
  response: z.object({ proposal: d.ProposalDto }),
  errors: [409],
});

export const changeSetsList = endpoint({
  id: "changeSets.list",
  method: "GET",
  path: `${V}/change-sets`,
  summary: "Change log with undo availability and support views (R2-ADM-7/8)",
  tag: "changes",
  auth: "household",
  roles: ADMIN,
  query: z.object({
    area: z.string().max(40).optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
  }),
  response: list("entries", d.ChangeLogEntryDto),
});

export const changeSetsGet = endpoint({
  id: "changeSets.get",
  method: "GET",
  path: `${V}/change-sets/{id}`,
  summary: "One change set",
  tag: "changes",
  auth: "household",
  roles: ADMIN,
  params: byId,
  response: d.ChangeSetDto,
});

export const changeSetsApply = endpoint({
  id: "changeSets.apply",
  method: "POST",
  path: `${V}/change-sets`,
  summary: "Apply registry ops as one change set (the configuration write path, DM-6)",
  tag: "changes",
  auth: "household",
  roles: ADMIN,
  body: d.ChangeSetBody,
  status: 201,
  response: d.AppliedDto,
  errors: [409, 422],
});

export const changeSetsPreview = endpoint({
  id: "changeSets.preview",
  method: "POST",
  path: `${V}/change-sets/preview`,
  summary: "Describe what ops would change, without applying them",
  tag: "changes",
  auth: "household",
  roles: ADMIN,
  body: d.PreviewBody,
  response: list("descriptions", d.DescriptionDto),
  errors: [422],
});

export const changeSetsUndo = endpoint({
  id: "changeSets.undo",
  method: "POST",
  path: `${V}/change-sets/{id}/undo`,
  summary: "Undo a change set (refused when a later change touched the same entities)",
  tag: "changes",
  auth: "household",
  roles: ADMIN,
  params: byId,
  response: ChangeSetRef,
  errors: [409],
});

export const insightsRun = endpoint({
  id: "insights.run",
  method: "POST",
  path: `${V}/insights/run`,
  summary: "Run the insights engine now (FBK-7)",
  tag: "changes",
  auth: "household",
  roles: ADMIN,
  status: 202,
  response: JobRef,
});

// Conversations, jobs, diagnostics ---------------------------------------------------------------

export const conversationsList = endpoint({
  id: "conversations.list",
  method: "GET",
  path: `${V}/conversations`,
  summary: "The admin's conversations",
  tag: "agent",
  auth: "household",
  roles: ADMIN,
  response: list("conversations", d.ConversationDto),
});

export const conversationsCreate = endpoint({
  id: "conversations.create",
  method: "POST",
  path: `${V}/conversations`,
  summary: "Start a conversation",
  tag: "agent",
  auth: "household",
  roles: ADMIN,
  body: z.object({ title: z.string().trim().min(1).max(120).default("New conversation") }).strict(),
  status: 201,
  response: d.ConversationDto,
});

export const conversationsGet = endpoint({
  id: "conversations.get",
  method: "GET",
  path: `${V}/conversations/{id}`,
  summary: "One conversation",
  tag: "agent",
  auth: "household",
  roles: ADMIN,
  params: byId,
  response: d.ConversationDto,
});

export const conversationMessages = endpoint({
  id: "conversations.messages",
  method: "GET",
  path: `${V}/conversations/{id}/messages`,
  summary: "Messages of a conversation, oldest first (append-only, AGT-8)",
  tag: "agent",
  auth: "household",
  roles: ADMIN,
  params: byId,
  response: list("messages", d.ChatMessageDto),
});

export const conversationsSend = endpoint({
  id: "conversations.send",
  method: "POST",
  path: `${V}/conversations/{id}/messages`,
  summary: "Send a message to the assistant; the turn streams as Server-Sent Events (AGT-2, AGT-7)",
  tag: "agent",
  auth: "household",
  roles: ADMIN,
  params: byId,
  body: d.ChatSendBody,
  format: "sse",
  response: d.ChatStreamEventDto,
  errors: [409, 429, 503],
});

export const jobsGet = endpoint({
  id: "jobs.get",
  method: "GET",
  path: `${V}/jobs/{id}`,
  summary: "A job's status",
  tag: "jobs",
  auth: "household",
  roles: ADMIN,
  params: byId,
  response: d.JobDto,
});

export const jobsEvents = endpoint({
  id: "jobs.events",
  method: "GET",
  path: `${V}/jobs/{id}/events`,
  summary: "A job's progress as Server-Sent Events (replays after Last-Event-ID)",
  tag: "jobs",
  auth: "household",
  roles: ADMIN,
  params: byId,
  format: "sse",
  response: d.JobEventDto,
});

export const diagnosticsGet = endpoint({
  id: "diagnostics.get",
  method: "GET",
  path: `${V}/diagnostics`,
  summary: "The last 50 AI calls and failed jobs of the household (ARC-12)",
  tag: "jobs",
  auth: "household",
  roles: ADMIN,
  response: d.DiagnosticsDto,
});

// Platform operator (R2-ADM-8) ---------------------------------------------------------------------

export const platformHouseholds = endpoint({
  id: "platform.households",
  method: "GET",
  path: `${V}/platform/households`,
  summary: "Households with counts and status (platform data only)",
  tag: "platform",
  auth: "operator",
  response: list("households", d.PlatformHouseholdDto),
});

export const platformSuspend = endpoint({
  id: "platform.suspend",
  method: "POST",
  path: `${V}/platform/households/{id}/suspend`,
  summary: "Suspend a household (its logins get 403 until reactivated)",
  tag: "platform",
  auth: "operator",
  params: byId,
  response: d.PlatformHouseholdDto,
  errors: [409],
});

export const platformReactivate = endpoint({
  id: "platform.reactivate",
  method: "POST",
  path: `${V}/platform/households/{id}/reactivate`,
  summary: "Reactivate a suspended household",
  tag: "platform",
  auth: "operator",
  params: byId,
  response: d.PlatformHouseholdDto,
  errors: [409],
});

export const platformDelete = endpoint({
  id: "platform.delete",
  method: "POST",
  path: `${V}/platform/households/{id}/delete`,
  summary: "Start deletion of a suspended household (14-day grace, cancellable by its admins)",
  tag: "platform",
  auth: "operator",
  params: byId,
  response: d.PlatformHouseholdDto,
  errors: [409],
});

export const platformUsers = endpoint({
  id: "platform.users",
  method: "GET",
  path: `${V}/platform/users`,
  summary: "Find users by email or name",
  tag: "platform",
  auth: "operator",
  query: z.object({ q: z.string().trim().min(2).max(100) }),
  response: list("users", d.PlatformUserDto),
});

export const platformBlock = endpoint({
  id: "platform.block",
  method: "POST",
  path: `${V}/platform/users/{id}/block`,
  summary: "Block a user on the whole platform (all sessions end now)",
  tag: "platform",
  auth: "operator",
  params: byId,
  response: d.PlatformUserDto,
  errors: [409],
});

export const platformUnblock = endpoint({
  id: "platform.unblock",
  method: "POST",
  path: `${V}/platform/users/{id}/unblock`,
  summary: "Lift a platform-wide block",
  tag: "platform",
  auth: "operator",
  params: byId,
  response: d.PlatformUserDto,
});

export const platformAiUsage = endpoint({
  id: "platform.aiUsage",
  method: "GET",
  path: `${V}/platform/ai-usage`,
  summary: "AI usage and cost by model and purpose",
  tag: "platform",
  auth: "operator",
  query: z.object({ days: z.coerce.number().int().min(1).max(366).default(30) }),
  response: d.AiUsageDto,
});

export const platformFailedJobs = endpoint({
  id: "platform.failedJobs",
  method: "GET",
  path: `${V}/platform/jobs/failed`,
  summary: "Failed jobs (kind, time and error only)",
  tag: "platform",
  auth: "operator",
  query: z.object({ hours: z.coerce.number().int().min(1).max(720).default(24) }),
  response: list("jobs", d.PlatformJobDto),
});

const supportParams = byId;

export const supportSummary = endpoint({
  id: "support.summary",
  method: "GET",
  path: `${V}/platform/households/{id}/support/summary`,
  summary: "Household settings and counts (needs an active support grant; logged)",
  tag: "platform",
  auth: "operator",
  params: supportParams,
  response: d.SupportSummaryDto,
});

export const supportMembers = endpoint({
  id: "support.members",
  method: "GET",
  path: `${V}/platform/households/{id}/support/members`,
  summary: "Members (needs an active support grant; logged)",
  tag: "platform",
  auth: "operator",
  params: supportParams,
  response: list("members", d.MemberDto),
});

export const supportPlans = endpoint({
  id: "support.plans",
  method: "GET",
  path: `${V}/platform/households/{id}/support/plans`,
  summary: "Plan days (needs an active support grant; logged)",
  tag: "platform",
  auth: "operator",
  params: supportParams,
  query: z.object({ from: IsoDate, to: IsoDate }),
  response: d.PlansDto,
});

export const supportChangeLog = endpoint({
  id: "support.changeLog",
  method: "GET",
  path: `${V}/platform/households/{id}/support/change-log`,
  summary: "Change log (needs an active support grant; logged)",
  tag: "platform",
  auth: "operator",
  params: supportParams,
  response: list("entries", d.ChangeLogEntryDto),
});

export const openapiGet = endpoint({
  id: "openapi.get",
  method: "GET",
  path: `${V}/openapi.json`,
  summary: "This API's OpenAPI 3.1 document",
  tag: "meta",
  auth: "public",
  response: z.record(z.string(), z.json()),
});

/** Every endpoint, in document order. */
// Portion biases (FBK-5, FBK-9; leaf 1.4.5, BLD-8 R-53) ------------------------------------------

export const portionBiasesList = endpoint({
  id: "portionBiases.list",
  method: "GET",
  path: `${V}/portion-biases`,
  summary: "Learned portion biases per member and component role (a member sees only their own)",
  tag: "reviews",
  auth: "household",
  roles: ADMIN_MEMBER,
  query: z.object({ memberId: Id.optional() }),
  response: list("biases", d.PortionBiasDto),
});

// BLD-8 R-52 (leaf 1.4.4) ------------------------------------------------------------------------

export const cookSheetsFlags = endpoint({
  id: "cookSheets.flags",
  method: "GET",
  path: `${V}/cook-sheets/{date}/flags`,
  summary:
    "Kitchen flags of a date with their substitution job and result (R2-UX-1; kitchen: own flags)",
  tag: "plans",
  auth: "household",
  roles: ADMIN_KITCHEN,
  params: z.object({ date: IsoDate }),
  response: d.KitchenFlagsDto,
});

export const plansPublish = endpoint({
  id: "plans.publish",
  method: "POST",
  path: `${V}/plans/{date}/publish`,
  summary: "Send a day's plan to the kitchen (logged, undoable)",
  tag: "plans",
  auth: "household",
  roles: ADMIN,
  params: z.object({ date: IsoDate }),
  response: ChangeSetRef,
  errors: [422],
});

export const planMealsStatus = endpoint({
  id: "planMeals.status",
  method: "POST",
  path: `${V}/plan-meals/{id}/status`,
  summary: "Mark a meal cooked, skipped or planned (logged, undoable)",
  tag: "plans",
  auth: "household",
  roles: ADMIN_KITCHEN,
  params: byId,
  body: d.PlanMealStatusBody,
  response: z.object({ changeSetId: Id, meal: d.PlanMealDto }),
  errors: [422],
});

export const ENDPOINTS = [
  signup,
  me,
  accountGet,
  accountUpdate,
  accountPassword,
  accountSessions,
  accountSessionRevoke,
  accountTotpEnable,
  accountTotpVerify,
  accountTotpDisable,
  accountNotifications,
  accountNotificationsSet,
  accountDelete,
  invitesList,
  invitesCreate,
  invitesResend,
  invitesRevoke,
  invitesLookup,
  invitesAccept,
  accessList,
  accessRole,
  accessBlock,
  accessUnblock,
  accessRemove,
  accessLinkMember,
  accessPasswordReset,
  accessSignOutAll,
  householdGet,
  householdExport,
  householdExportCsv,
  householdDeletion,
  householdDeletionRequest,
  householdDeletionConfirm,
  householdDeletionCancel,
  supportGrantsList,
  supportGrantsCreate,
  supportGrantsRevoke,
  membersList,
  membersGet,
  targetsList,
  slotsList,
  schedulesGet,
  weightsGet,
  presetsList,
  exclusionsList,
  frequencyRulesList,
  mealOverridesList,
  dishesList,
  dishesGet,
  ingredientsList,
  ingredientsGet,
  cuisinesList,
  methodsList,
  plansList,
  plansGenerate,
  planMealsGet,
  planMealsAlternatives,
  planMealsSwap,
  planMealsLock,
  planMealsUnlock,
  platesGet,
  platesOverride,
  cookSheetsGet,
  cookSheetsFlag,
  // BLD-8 R-52 (leaf 1.4.4)
  cookSheetsFlags,
  plansPublish,
  planMealsStatus,
  reviewsList,
  reviewsCreate,
  reviewsEdit,
  reviewsReply,
  reviewsReact,
  reviewsRevisions,
  preferencesList,
  preferencesSet,
  preferencesReset,
  detailLevelsList,
  detailLevelsSet,
  proposalsList,
  proposalsAccept,
  proposalsReject,
  changeSetsList,
  changeSetsGet,
  changeSetsApply,
  changeSetsPreview,
  changeSetsUndo,
  insightsRun,
  conversationsList,
  conversationsCreate,
  conversationsGet,
  conversationMessages,
  conversationsSend,
  jobsGet,
  jobsEvents,
  diagnosticsGet,
  platformHouseholds,
  platformSuspend,
  platformReactivate,
  platformDelete,
  platformUsers,
  platformBlock,
  platformUnblock,
  platformAiUsage,
  platformFailedJobs,
  supportSummary,
  supportMembers,
  supportPlans,
  supportChangeLog,
  openapiGet,
  // Portion biases (leaf 1.4.5, R-53)
  portionBiasesList,
] as const;

/** Endpoints by id. */
export const ENDPOINTS_BY_ID: ReadonlyMap<string, (typeof ENDPOINTS)[number]> = new Map(
  ENDPOINTS.map((e) => [e.id, e]),
);

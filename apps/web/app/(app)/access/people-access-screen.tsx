"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { z } from "zod";
import {
  accessLinkMember,
  accessList,
  accessPasswordReset,
  accessRole,
  accessSignOutAll,
  accessUnblock,
  changeSetsApply,
  householdGet,
  invitesList,
  invitesResend,
  invitesRevoke,
  me,
  membersList,
  type AccessListDto,
  type MemberDto,
} from "@mealplanner/api-contract/contract";
import { HOUSEHOLD_ROLES, type HouseholdRole } from "@mealplanner/core/types";
import { isAvatarColor } from "@mealplanner/ui-tokens/tokens";
import { ROUTES } from "../../(shell)/_shell/nav";
import { ActionsMenu } from "../../../components/admin/actions-menu";
import { api, problemMessage } from "../../../components/admin/api";
import {
  BlockDialog,
  type BlockAction,
  type LoginTarget,
} from "../../../components/admin/block-dialog";
import { FormError, Notice, SelectField } from "../../../components/admin/field";
import {
  ageFrom,
  expiresIn,
  groupCode,
  lastActive,
  plural,
  ROLE_LABEL,
} from "../../../components/admin/format";
import { InviteDialog, InviteShare, type Invite } from "../../../components/admin/invite-dialog";
import { LoadError } from "../../../components/admin/load-error";
import { useLoad } from "../../../components/admin/use-load";
import { Avatar } from "../../../components/ui/avatar";
import { Button } from "../../../components/ui/button";
import { Icon } from "../../../components/ui/icon";
import { Dialog } from "../../../components/ui/sheet";
import { SkeletonBlock } from "../../../components/ui/skeleton";

type Access = z.output<typeof AccessListDto>;
type Login = Access["logins"][number];
type Member = z.output<typeof MemberDto>;

interface Data {
  access: Access;
  invites: Invite[];
  members: Member[];
  requireTotp: boolean;
  /** Whether the viewer has two-step sign-in on (requiring it without having it locks them out). */
  viewerHasTotp: boolean;
}

type Filter = "logins" | "invites" | "blocked";

const ROLE_TEXT: Readonly<Record<HouseholdRole, string>> = {
  admin: "text-sea-text",
  member: "text-ink",
  kitchen: "text-aubergine-text",
};

const STATUS: Readonly<Record<string, { label: string; cls: string }>> = {
  active: { label: "Active", cls: "bg-basil-tint text-basil-text" },
  invited: { label: "Invited", cls: "bg-saffron-tint text-saffron-text" },
  blocked: { label: "Blocked", cls: "bg-pomegranate-tint text-pomegranate-text" },
};

function StatusPill({ status }: { readonly status: keyof typeof STATUS }) {
  const s = STATUS[status] ?? { label: status, cls: "bg-flour text-ink-muted" };
  return (
    <span className={`inline-block rounded-full px-2.5 py-1 text-[13px] font-extrabold ${s.cls}`}>
      {s.label}
    </span>
  );
}

// One column template for the header and every row, so the columns line up (PeopleAccess:
// login 230, eats as 130, role 150, status 130, last active 150, actions). Fractions shrink
// together below 1280 px; the actions column is fixed so it never pushes the others.
const GRID =
  "lg:grid lg:grid-cols-[minmax(0,23fr)_minmax(0,13fr)_minmax(0,15fr)_minmax(0,12fr)_minmax(0,14fr)_150px] lg:items-center lg:gap-3";

export function PeopleAccessScreen({ viewerUserId }: { readonly viewerUserId: string }) {
  const load = useLoad<Data>(async () => {
    const [access, invites, members, household, who] = await Promise.all([
      api.call(accessList, {}),
      api.call(invitesList, {}),
      api.call(membersList, {}),
      api.call(householdGet, {}),
      api.call(me, {}),
    ]);
    return {
      access,
      invites: invites.invites ?? [],
      members: members.members ?? [],
      requireTotp: household.requireTotpForAdmins,
      viewerHasTotp: who.user.twoFactorEnabled,
    };
  });
  const [filter, setFilter] = useState<Filter>("logins");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [inviteFor, setInviteFor] = useState<{ memberId: string | null } | null>(null);
  const [block, setBlock] = useState<{ target: LoginTarget; action: BlockAction } | null>(null);
  const [linking, setLinking] = useState<Login | null>(null);
  const [shared, setShared] = useState<Invite | null>(null);

  const data = load.status === "ready" ? load.data : null;
  const memberById = useMemo(() => new Map((data?.members ?? []).map((m) => [m.id, m])), [data]);

  if (load.status === "loading")
    return (
      <Frame>
        <SkeletonBlock label="Loading people and access" lines={6} />
      </Frame>
    );
  if (load.status === "error")
    return (
      <Frame>
        <LoadError message={load.message} onRetry={() => void load.reload()} />
      </Frame>
    );

  const { access, invites, members, requireTotp, viewerHasTotp } = load.data;
  const openInvites = invites.filter((i) => i.status === "open");
  const activeAdmins = access.logins.filter((l) => l.role === "admin" && l.status === "active");
  const blockedCount = access.logins.filter((l) => l.status === "blocked").length;
  const q = query.trim().toLowerCase();
  const matches = (text: string | null) => text !== null && text.toLowerCase().includes(q);

  const logins = access.logins
    .filter((l) => (filter === "blocked" ? l.status === "blocked" : true))
    .filter((l) => q === "" || matches(l.name) || matches(l.email) || matches(l.memberName))
    .sort((a, b) => (a.userId === viewerUserId ? -1 : b.userId === viewerUserId ? 1 : 0));
  const inviteRows = openInvites.filter(
    (i) =>
      q === "" ||
      matches(i.memberId === null ? null : (memberById.get(i.memberId)?.displayName ?? null)) ||
      matches(i.code),
  );
  const withoutLogin = access.membersWithoutLogin
    .map((m) => ({ ...m, member: memberById.get(m.memberId) }))
    .filter((m) => m.member?.archivedAt == null);

  async function run(fn: () => Promise<string>) {
    setError(null);
    setStatus(null);
    try {
      setStatus(await fn());
      await load.reload();
    } catch (err) {
      setError(problemMessage(err));
      await load.reload();
    }
  }

  function targetOf(l: Login): LoginTarget {
    const m = l.memberId === null ? undefined : memberById.get(l.memberId);
    return {
      userId: l.userId,
      name: l.name,
      email: l.email,
      role: l.role,
      memberId: l.memberId,
      memberName: l.memberName,
      memberColor: m?.color ?? null,
    };
  }

  const isLastAdmin = (l: Login) =>
    l.role === "admin" && l.status === "active" && activeAdmins.length <= 1;

  return (
    <Frame
      action={
        <Button
          icon="plus"
          size="lg"
          onClick={() => {
            setInviteFor({ memberId: null });
          }}
        >
          Invite someone
        </Button>
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        {(
          [
            ["logins", `Logins · ${String(access.logins.length)}`],
            ["invites", `Pending invites · ${String(openInvites.length)}`],
            ["blocked", `Blocked · ${String(blockedCount)}`],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            aria-pressed={filter === key}
            onClick={() => {
              setFilter(key);
            }}
            className="min-h-11 rounded-full bg-flour px-3.5 text-sm font-extrabold text-ink aria-pressed:bg-ink aria-pressed:text-paper"
          >
            {label}
          </button>
        ))}
        <label className="flex h-11 w-full items-center gap-2 rounded-[12px] border-[1.5px] border-line bg-card px-3 lg:ml-auto lg:w-[260px]">
          <Icon name="search" size={16} className="text-ink-muted" />
          <span className="sr-only">Search people</span>
          <input
            type="search"
            placeholder="Search people"
            value={query}
            onChange={(e) => {
              setQuery(e.currentTarget.value);
            }}
            className="min-w-0 grow border-0 bg-transparent text-sm text-ink outline-none placeholder:text-ink-muted"
          />
        </label>
      </div>

      <Notice>{status}</Notice>
      <FormError>{error}</FormError>

      <section aria-label="Logins" className="rounded-[20px] bg-card shadow-card">
        <div
          aria-hidden
          className={`hidden rounded-t-[20px] bg-flour px-5 py-3 text-xs font-extrabold tracking-[0.06em] text-ink-muted uppercase ${GRID}`}
        >
          <span>Login</span>
          <span>Eats as</span>
          <span>Role</span>
          <span>Status</span>
          <span>Last active</span>
          <span />
        </div>
        <ul className="m-0 list-none p-0">
          {filter !== "invites" &&
            logins.map((l) => {
              const self = l.userId === viewerUserId;
              const m = l.memberId === null ? undefined : memberById.get(l.memberId);
              const lastAdmin = isLastAdmin(l);
              return (
                <li
                  key={l.userId}
                  data-testid={`login-${l.email}`}
                  className={`flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-flour px-5 py-3.5 last:border-b-0 ${GRID}`}
                >
                  <span className="flex w-full min-w-0 items-center gap-2.5 lg:w-auto">
                    <Avatar
                      name={l.name}
                      color={isAvatarColor(m?.color) ? m.color : null}
                      colorKey={l.memberId ?? l.userId}
                    />
                    <span className="flex min-w-0 flex-col">
                      <span
                        className={`truncate font-extrabold ${l.status === "blocked" ? "text-ink-soft" : ""}`}
                      >
                        {l.name}
                        {self ? " (you)" : ""}
                      </span>
                      <span className="truncate text-[13px] text-ink-soft">{l.email}</span>
                    </span>
                  </span>
                  <span className={l.memberName === null ? "text-ink-muted" : ""}>
                    <span className="text-ink-muted lg:hidden">Eats as: </span>
                    {l.memberName ?? "Doesn't eat"}
                  </span>
                  <span>
                    {self || lastAdmin || l.status === "blocked" ? (
                      <span
                        className={`font-extrabold ${l.status === "blocked" ? "text-ink-soft" : ROLE_TEXT[l.role]}`}
                        title={lastAdmin ? "The last admin can't be demoted" : undefined}
                      >
                        {ROLE_LABEL[l.role]}
                      </span>
                    ) : (
                      <SelectField
                        label={`Role for ${l.name}`}
                        hideLabel
                        value={l.role}
                        onChange={(e) => {
                          const role = e.currentTarget.value as HouseholdRole;
                          void run(async () => {
                            await api.call(accessRole, {
                              params: { userId: l.userId },
                              body: { role },
                            });
                            return `${l.name} is now ${ROLE_LABEL[role].toLowerCase()}.`;
                          });
                        }}
                        className="w-[140px] [&_select]:h-11 [&_select]:font-extrabold"
                      >
                        {HOUSEHOLD_ROLES.map((r) => (
                          <option key={r} value={r}>
                            {ROLE_LABEL[r]}
                          </option>
                        ))}
                      </SelectField>
                    )}
                  </span>
                  <span>
                    <StatusPill status={l.status} />
                  </span>
                  <span className="text-sm">
                    <span className="text-ink-muted lg:hidden">Last active: </span>
                    {self ? "Now" : lastActive(l.lastActiveAt)}
                  </span>
                  <span className="flex items-center justify-start gap-3 text-sm font-extrabold lg:justify-end">
                    {self ? null : l.status === "blocked" ? (
                      <>
                        <button
                          type="button"
                          className="min-h-11 font-extrabold text-action"
                          onClick={() => {
                            void run(async () => {
                              await api.call(accessUnblock, { params: { userId: l.userId } });
                              return `${l.name} is unblocked and can sign in again.`;
                            });
                          }}
                        >
                          Unblock
                        </button>
                        <button
                          type="button"
                          className="min-h-11 font-extrabold text-pomegranate-text"
                          onClick={() => {
                            setBlock({ target: targetOf(l), action: "remove" });
                          }}
                        >
                          Remove
                        </button>
                      </>
                    ) : lastAdmin ? null : (
                      <ActionsMenu
                        label={`More actions for ${l.name}`}
                        actions={[
                          ...(l.memberId === null
                            ? []
                            : [
                                {
                                  label: `Open ${l.memberName ?? l.name}'s family profile`,
                                  onSelect: () => {
                                    window.location.assign(`${ROUTES.family}/${l.memberId ?? ""}`);
                                  },
                                },
                              ]),
                          {
                            label: "Send password reset link",
                            onSelect: () => {
                              void run(async () => {
                                await api.call(accessPasswordReset, {
                                  params: { userId: l.userId },
                                });
                                return `A password reset link is on its way to ${l.email}.`;
                              });
                            },
                          },
                          {
                            label: "Sign out of all devices",
                            onSelect: () => {
                              void run(async () => {
                                const r = await api.call(accessSignOutAll, {
                                  params: { userId: l.userId },
                                });
                                return `${l.name} is signed out of ${plural(r.sessionsRevoked, "device", "devices")}.`;
                              });
                            },
                          },
                          {
                            label: "Link to a different person",
                            onSelect: () => {
                              setLinking(l);
                            },
                          },
                          {
                            label: "Block…",
                            danger: true,
                            separated: true,
                            onSelect: () => {
                              setBlock({ target: targetOf(l), action: "block" });
                            },
                          },
                          {
                            label: "Remove from household…",
                            danger: true,
                            onSelect: () => {
                              setBlock({ target: targetOf(l), action: "remove" });
                            },
                          },
                        ]}
                      />
                    )}
                  </span>
                </li>
              );
            })}
          {filter !== "blocked" &&
            inviteRows.map((i) => {
              const m = i.memberId === null ? undefined : memberById.get(i.memberId);
              const name = m?.displayName ?? `${ROLE_LABEL[i.role]} invite`;
              return (
                <li
                  key={i.id}
                  data-testid={`invite-${i.code}`}
                  className={`flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-flour px-5 py-3.5 last:border-b-0 ${GRID}`}
                >
                  <span className="flex w-full min-w-0 items-center gap-2.5 lg:w-auto">
                    <Avatar
                      name={name}
                      color={isAvatarColor(m?.color) ? m.color : null}
                      colorKey={i.memberId ?? i.id}
                    />
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate font-extrabold">{name}</span>
                      <span className="truncate font-mono text-[13px] text-ink-soft">
                        {groupCode(i.code)}
                      </span>
                    </span>
                  </span>
                  <span className={m === undefined ? "text-ink-muted" : ""}>
                    <span className="text-ink-muted lg:hidden">Eats as: </span>
                    {m?.displayName ?? "Doesn't eat"}
                  </span>
                  <span className={`font-extrabold ${ROLE_TEXT[i.role]}`}>
                    {ROLE_LABEL[i.role]}
                  </span>
                  <span>
                    <StatusPill status="invited" />
                  </span>
                  <span className="text-sm">{expiresIn(i.expiresAt)}</span>
                  <span className="flex items-center gap-4 text-sm font-extrabold lg:justify-end">
                    <button
                      type="button"
                      className="min-h-11 font-extrabold text-action"
                      onClick={() => {
                        void run(async () => {
                          const fresh = await api.call(invitesResend, {
                            params: { id: i.id },
                            body: { channel: "link" },
                          });
                          setShared(fresh);
                          return `A new code replaces ${groupCode(i.code)}.`;
                        });
                      }}
                    >
                      Resend
                    </button>
                    <button
                      type="button"
                      className="min-h-11 font-extrabold text-pomegranate-text"
                      onClick={() => {
                        void run(async () => {
                          await api.call(invitesRevoke, { params: { id: i.id } });
                          return `The invite ${groupCode(i.code)} is revoked.`;
                        });
                      }}
                    >
                      Revoke
                    </button>
                  </span>
                </li>
              );
            })}
          {(filter === "invites"
            ? inviteRows.length
            : logins.length + (filter === "blocked" ? 0 : inviteRows.length)) === 0 && (
            <li className="px-5 py-6 text-ink-soft">
              {q !== ""
                ? "Nobody matches that search."
                : filter === "invites"
                  ? "No invites are waiting. Use “Invite someone” to add a login."
                  : filter === "blocked"
                    ? "Nobody is blocked."
                    : "No logins yet."}
            </li>
          )}
        </ul>
      </section>

      <div className="flex flex-col gap-4 lg:flex-row">
        <section
          aria-labelledby="without-login"
          className="flex grow flex-col gap-2.5 rounded-[20px] bg-card px-5 py-[18px] shadow-card"
        >
          <h2 id="without-login" className="font-body text-[15px] font-extrabold">
            Family members without a login
          </h2>
          {withoutLogin.length === 0 ? (
            <p className="m-0 text-sm text-ink-soft">Everyone in the family has a login.</p>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
              {withoutLogin.map(({ memberId, displayName, member }) => {
                const age = ageFrom(member?.birthYear ?? null);
                return (
                  <li key={memberId} className="flex flex-wrap items-center gap-2.5">
                    <Avatar
                      name={displayName}
                      color={isAvatarColor(member?.color) ? member.color : null}
                      colorKey={memberId}
                    />
                    <span className="flex grow flex-col">
                      <span className="font-extrabold">
                        {displayName}
                        {age === null ? "" : `, ${String(age)}`}
                      </span>
                      <span className="text-[13px] text-ink-soft">
                        Admins leave feedback on their behalf
                      </span>
                    </span>
                    <button
                      type="button"
                      className="min-h-11 font-extrabold text-action"
                      onClick={() => {
                        setInviteFor({ memberId });
                      }}
                    >
                      Give {displayName} a login
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
        <section
          aria-labelledby="security"
          className="flex flex-col gap-2.5 rounded-[20px] bg-card px-5 py-[18px] shadow-card lg:w-[380px]"
        >
          <h2 id="security" className="font-body text-[15px] font-extrabold">
            Security
          </h2>
          <label className="flex min-h-11 items-center justify-between gap-3 text-sm font-bold">
            Require two-step sign-in for admins
            <input
              type="checkbox"
              checked={requireTotp}
              // Turning it on without having it would lock the viewer out of every admin screen.
              disabled={!requireTotp && !viewerHasTotp}
              aria-describedby={!requireTotp && !viewerHasTotp ? "totp-first" : undefined}
              onChange={(e) => {
                const on = e.currentTarget.checked;
                void run(async () => {
                  await api.call(changeSetsApply, {
                    body: {
                      summary: on
                        ? "Require two-step sign-in for admins"
                        : "Stop requiring two-step sign-in for admins",
                      ops: [{ kind: "household.update", payload: { requireTotpForAdmins: on } }],
                    },
                  });
                  return on
                    ? "Admins now need two-step sign-in. Anyone without it is asked to turn it on in My account."
                    : "Two-step sign-in is optional for admins again.";
                });
              }}
              className="size-5 shrink-0 accent-[var(--action)]"
            />
          </label>
          {!requireTotp && !viewerHasTotp && (
            <span id="totp-first" className="text-[13px] text-ink-soft">
              Turn on two-step sign-in for yourself in{" "}
              <Link href="/account" className="font-extrabold">
                My account
              </Link>{" "}
              first.
            </span>
          )}
          <span className="text-[13px] text-ink-soft">
            {plural(activeAdmins.length, "admin", "admins")}. The last admin can&rsquo;t be removed,
            blocked or demoted.
          </span>
        </section>
      </div>

      <InviteDialog
        open={inviteFor !== null}
        onOpenChange={(open) => {
          if (!open) setInviteFor(null);
        }}
        members={withoutLogin.map((m) => ({
          memberId: m.memberId,
          displayName: m.displayName,
          color: m.member?.color ?? null,
        }))}
        initialMemberId={inviteFor?.memberId ?? null}
        onChanged={() => void load.reload()}
      />
      <BlockDialog
        target={block?.target ?? null}
        initial={block?.action ?? "block"}
        onOpenChange={(open) => {
          if (!open) setBlock(null);
        }}
        onDone={(message) => {
          setError(null);
          setStatus(message);
          void load.reload();
        }}
      />
      {linking !== null && (
        <LinkMemberDialog
          login={linking}
          members={members.filter((m) => m.archivedAt === null)}
          taken={
            new Set(
              access.logins.flatMap((l) =>
                l.memberId === null || l.userId === linking.userId ? [] : [l.memberId],
              ),
            )
          }
          onClose={() => {
            setLinking(null);
          }}
          onLinked={(message) => {
            setLinking(null);
            setStatus(message);
            void load.reload();
          }}
        />
      )}
      {shared !== null && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) setShared(null);
          }}
          title="New invite code"
          width={820}
        >
          <InviteShare
            invite={shared}
            emailedTo={null}
            onDone={() => {
              setShared(null);
            }}
          />
        </Dialog>
      )}
    </Frame>
  );
}

function Frame({
  children,
  action,
}: {
  readonly children: React.ReactNode;
  readonly action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[28px] lg:text-[34px]">People &amp; access</h1>
          <p className="m-0 mt-1 text-ink-soft">
            Who can sign in, what they can do, and who they are at the table.
          </p>
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

/** "Link to a different person" (R2-ADM-3): the member this login eats as, or none. */
function LinkMemberDialog({
  login,
  members,
  taken,
  onClose,
  onLinked,
}: {
  readonly login: Login;
  readonly members: readonly Member[];
  readonly taken: ReadonlySet<string>;
  readonly onClose: () => void;
  readonly onLinked: (message: string) => void;
}) {
  const [memberId, setMemberId] = useState<string>(login.memberId ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={`Who is ${login.name} at the table?`}
      width={520}
    >
      <SelectField
        label="Eats as"
        value={memberId}
        onChange={(e) => {
          setMemberId(e.currentTarget.value);
        }}
      >
        <option value="">Doesn&rsquo;t eat here</option>
        {members.map((m) => (
          <option key={m.id} value={m.id} disabled={taken.has(m.id)}>
            {m.displayName}
            {taken.has(m.id) ? " (has a login)" : ""}
          </option>
        ))}
      </SelectField>
      <FormError>{error}</FormError>
      <div className="flex flex-wrap justify-end gap-3">
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button
          loading={busy}
          disabled={memberId === (login.memberId ?? "")}
          onClick={() => {
            setBusy(true);
            setError(null);
            void api
              .call(accessLinkMember, {
                params: { userId: login.userId },
                body: { memberId: memberId === "" ? null : memberId },
              })
              .then(() => {
                const name = members.find((m) => m.id === memberId)?.displayName;
                onLinked(
                  name === undefined
                    ? `${login.name} no longer eats as anyone.`
                    : `${login.name} now eats as ${name}.`,
                );
              })
              .catch((err: unknown) => {
                setError(problemMessage(err));
                setBusy(false);
              });
          }}
        >
          Save
        </Button>
      </div>
    </Dialog>
  );
}

"use client";
// Family (UX-4 Family; MemberSimple, MemberDetailed): member cards on the left, the selected
// member's sections on the right; on a phone the list and a member are separate pages. Each
// configurable section carries its own detail control (R2-DL-1).
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { MEMBER_COLOR_ORDER, weekdayText } from "@mealplanner/core/onboarding";
import { isAvatarColor } from "@mealplanner/ui-tokens/tokens";
import { api, applyChanges, c, problemText } from "./api";
import { newId } from "./ids";
import { hhmm, memberAge, useHousehold, type HouseholdData, type Member } from "./data";
import { MealsSection } from "./meals-section";
import { FLAG_LABEL, NeverServeList } from "./never-serve";
import { ErrorBlock, LoadingBlock, readNumber, SaveStatus, Section } from "./parts";
import { TargetsSection } from "./targets-section";
import { TastesSection } from "./tastes-section";
import { TrainingSection } from "./training-section";
import { Avatar } from "../ui/avatar";
import { EmptyState } from "../ui/empty-state";
import { LinkButton } from "../ui/button";
import { Icon } from "../ui/icon";

const YEAR = new Date().getFullYear();

function allergySummary(data: HouseholdData, member: Member): string | null {
  const allergies = data.exclusions.filter(
    (e) => e.memberId === member.id && e.reason === "allergy",
  );
  if (allergies.length === 0) return null;
  const what = allergies.map((e) =>
    e.kind === "dietary_flag"
      ? (FLAG_LABEL[e.key] ?? e.key)
      : (data.ingredients.find((i) => i.slug === e.key)?.name ?? e.key).toLowerCase(),
  );
  const text = `${what.join(", ")} allerg${what.length === 1 ? "y" : "ies"}`;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function trainingDays(data: HouseholdData, member: Member): number[] {
  return data.schedules.training.filter((t) => t.memberId === member.id).map((t) => t.weekday);
}

function MemberCard({
  data,
  member,
  current,
}: {
  readonly data: HouseholdData;
  readonly member: Member;
  readonly current: boolean;
}) {
  const age = memberAge(member, YEAR);
  const days = trainingDays(data, member);
  const allergy = allergySummary(data, member);
  return (
    <Link
      href={`/family/${member.id}`}
      aria-current={current ? "page" : undefined}
      data-member-card={member.displayName}
      className={`flex items-center gap-2.5 rounded-2xl bg-card p-3 text-ink no-underline ${current ? "border-[2.5px] border-action" : "shadow-card"}`}
    >
      <Avatar
        name={member.displayName}
        color={isAvatarColor(member.color) ? member.color : null}
        colorKey={member.id}
        size={44}
      />
      <span className="flex min-w-0 flex-col">
        <span className="font-extrabold">
          {member.displayName}
          {!member.isTargeted && age !== null ? `, ${String(age)}` : ""}
        </span>
        {member.isTargeted ? (
          <span className="text-[13px] font-bold text-sea-text">
            Targets{days.length > 0 ? ` · trains ${weekdayText(days)}` : ""}
          </span>
        ) : (
          <span className="text-[13px] text-ink-soft">No targets · {member.appetite} appetite</span>
        )}
        {allergy !== null && (
          <span className="text-[13px] font-bold text-pomegranate-text">{allergy}</span>
        )}
      </span>
    </Link>
  );
}

function AddPerson({
  data,
  onAdded,
}: {
  readonly data: HouseholdData;
  readonly onAdded: (id: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [age, setAge] = useState("");
  const [error, setError] = useState<string | null>(null);
  if (!open)
    return (
      <button
        type="button"
        onClick={() => {
          setOpen(true);
        }}
        className="min-h-12 rounded-xl border-[1.5px] border-dashed border-action bg-transparent font-extrabold text-action"
      >
        Add a person
      </button>
    );
  return (
    <form
      aria-label="Add a person"
      className="flex flex-col gap-2 rounded-2xl bg-card p-3 shadow-card"
      onSubmit={(e) => {
        e.preventDefault();
        const years = readNumber(age);
        if (name.trim() === "") {
          setError("Give them a name.");
          return;
        }
        if (years !== null && (!Number.isFinite(years) || years > 120)) {
          setError("Age is a number of years.");
          return;
        }
        const id = newId();
        const appetite =
          years === null ? "medium" : years >= 14 ? "large" : years >= 8 ? "medium" : "small";
        void applyChanges(`Add ${name.trim()}`, [
          {
            kind: "member.create",
            payload: {
              id,
              displayName: name.trim(),
              color: MEMBER_COLOR_ORDER[data.members.length % MEMBER_COLOR_ORDER.length] ?? "sea",
              birthYear: years === null ? null : YEAR - Math.round(years),
              isTargeted: false,
              appetite,
            },
          },
        ])
          .then(async () => {
            setOpen(false);
            setName("");
            setAge("");
            await onAdded(id);
          })
          .catch((err: unknown) => {
            setError(problemText(err));
          });
      }}
    >
      <label className="flex flex-col gap-1 text-sm font-extrabold">
        Name
        <input
          value={name}
          onChange={(e) => {
            setName(e.target.value);
          }}
          className="min-h-11 rounded-md border-[1.5px] border-line-strong px-2 font-normal"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm font-extrabold">
        Age
        <input
          inputMode="numeric"
          value={age}
          onChange={(e) => {
            setAge(e.target.value);
          }}
          className="min-h-11 rounded-md border-[1.5px] border-line-strong px-2 font-normal"
        />
      </label>
      <p className="m-0 text-xs text-ink-soft">
        Starting portions come from age. Add targets on their page.
      </p>
      <div className="flex gap-2">
        <button
          type="submit"
          className="min-h-11 rounded-md bg-action px-4 font-extrabold text-on-action"
        >
          Add
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
          }}
          className="min-h-11 rounded-md bg-flour px-4 font-extrabold text-ink"
        >
          Cancel
        </button>
      </div>
      {error !== null && (
        <p role="alert" className="m-0 text-sm font-bold text-pomegranate-text">
          {error}
        </p>
      )}
    </form>
  );
}

function subtitle(
  data: HouseholdData,
  member: Member,
  login: { role: string; email: string } | undefined,
): string {
  const parts: string[] = [];
  if (login !== undefined)
    parts.push(
      `${login.role.charAt(0).toUpperCase()}${login.role.slice(1)} login · ${login.email}`,
    );
  const training = data.schedules.training.filter((t) => t.memberId === member.id);
  if (training.length > 0) {
    const times = [
      ...new Set(training.map((t) => (t.sessionTime === null ? null : hhmm(t.sessionTime)))),
    ];
    parts.push(
      `trains ${weekdayText(training.map((t) => t.weekday))}${times.length === 1 && times[0] !== null && times[0] !== undefined ? ` at ${times[0]}` : ""}`,
    );
  }
  for (const slot of data.slots.filter((s) => s.isPacked && s.active)) {
    const days = data.schedules.slotSchedules
      .filter((r) => r.memberId === member.id && r.slotTypeId === slot.id && r.attends)
      .map((r) => r.weekday);
    if (days.length > 0) parts.push(`${slot.label.toLowerCase()} ${weekdayText(days)}`);
  }
  return parts.join(" · ");
}

function Profile({
  data,
  member,
  onChanged,
}: {
  readonly data: HouseholdData;
  readonly member: Member;
  readonly onChanged: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(member.displayName);
  const [birthYear, setBirthYear] = useState(member.birthYear?.toString() ?? "");
  const [appetite, setAppetite] = useState(member.appetite);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  if (!open)
    return (
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => {
            setOpen(true);
          }}
          className="min-h-11 text-sm font-extrabold text-action underline"
        >
          Edit name, age and appetite
        </button>
        <SaveStatus error={error} saved={saved} />
      </div>
    );
  return (
    <form
      aria-label={`${member.displayName}'s profile`}
      className="flex flex-wrap items-end gap-3 rounded-2xl bg-card p-3 shadow-card"
      onSubmit={(e) => {
        e.preventDefault();
        const year = readNumber(birthYear);
        if (year !== null && (!Number.isFinite(year) || year < 1900 || year > YEAR)) {
          setError("Birth year is a year, like 2012.");
          return;
        }
        void applyChanges(`Update ${member.displayName}`, [
          {
            kind: "member.update",
            payload: { memberId: member.id, displayName: name.trim(), birthYear: year, appetite },
          },
        ])
          .then(async () => {
            setOpen(false);
            setSaved(true);
            setError(null);
            await onChanged();
          })
          .catch((err: unknown) => {
            setError(problemText(err));
          });
      }}
    >
      <label className="flex flex-col gap-1 text-sm font-extrabold">
        Name
        <input
          value={name}
          onChange={(e) => {
            setName(e.target.value);
          }}
          className="min-h-11 rounded-md border-[1.5px] border-line-strong px-2 font-normal"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm font-extrabold">
        Birth year
        <input
          inputMode="numeric"
          value={birthYear}
          onChange={(e) => {
            setBirthYear(e.target.value);
          }}
          className="min-h-11 w-28 rounded-md border-[1.5px] border-line-strong px-2 font-normal"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm font-extrabold">
        Appetite
        <select
          value={appetite}
          onChange={(e) => {
            setAppetite(e.target.value as Member["appetite"]);
          }}
          className="min-h-11 rounded-md border-[1.5px] border-line-strong bg-card px-2 font-normal"
        >
          <option value="small">small</option>
          <option value="medium">medium</option>
          <option value="large">large</option>
        </select>
      </label>
      <button
        type="submit"
        className="min-h-11 rounded-md bg-action px-4 font-extrabold text-on-action"
      >
        Save
      </button>
      <button
        type="button"
        onClick={() => {
          setOpen(false);
        }}
        className="min-h-11 rounded-md bg-flour px-4 font-extrabold text-ink"
      >
        Cancel
      </button>
      {error !== null && (
        <p role="alert" className="m-0 w-full text-sm font-bold text-pomegranate-text">
          {error}
        </p>
      )}
      <p className="m-0 w-full text-xs text-ink-soft">
        {data.household.name} sets appetite only for people without targets.
      </p>
    </form>
  );
}

export function FamilyScreen({ selectedId }: { readonly selectedId: string | null }) {
  const { data, error, loading, reload } = useHousehold();
  const router = useRouter();
  const [logins, setLogins] = useState<{ memberId: string | null; role: string; email: string }[]>(
    [],
  );
  useEffect(() => {
    void api
      .call(c.accessList, {})
      .then((r) => {
        setLogins(r.logins);
      })
      .catch(() => undefined);
  }, []);
  // Scroll to the section an Adjust link names (#targets, #meals …) once it has rendered.
  useEffect(() => {
    if (data === null) return;
    const hash = window.location.hash.slice(1);
    if (hash !== "") document.getElementById(hash)?.scrollIntoView({ block: "start" });
  }, [data]);
  if (data === null)
    return error === null || loading ? (
      <LoadingBlock label="Loading the family" />
    ) : (
      <ErrorBlock message={error} onRetry={() => void reload()} />
    );
  if (data.members.length === 0)
    return (
      <EmptyState
        headingLevel={1}
        icon="family"
        title="No one here yet"
        description="Five quick questions set up the family, their targets and the week."
        action={<LinkButton href="/onboarding">Set up the household</LinkButton>}
      />
    );
  const selected =
    data.members.find((m) => m.id === selectedId) ??
    (selectedId === null ? data.members[0] : undefined);
  const login = logins.find((l) => l.memberId === selected?.id);
  return (
    <div className="flex flex-col gap-6 lg:flex-row">
      <nav
        aria-label="Family members"
        className={`flex shrink-0 flex-col gap-2.5 lg:w-[250px] ${selectedId === null ? "" : "max-lg:hidden"}`}
      >
        <h1 className="mb-1 text-[34px]">Family</h1>
        {data.members.map((m) => (
          <MemberCard key={m.id} data={data} member={m} current={m.id === selected?.id} />
        ))}
        <AddPerson
          data={data}
          onAdded={async (id) => {
            await reload();
            router.push(`/family/${id}`);
          }}
        />
        <Link href="/family/tastes" className="mt-2 text-sm font-extrabold">
          Family tastes
        </Link>
      </nav>
      {selected === undefined ? (
        <p className="m-0">This person is not in the family any more.</p>
      ) : (
        <div
          className={`flex min-w-0 grow flex-col gap-4 ${selectedId === null ? "max-lg:hidden" : ""}`}
          key={selected.id}
        >
          <div id="profile" className="flex scroll-mt-6 flex-wrap items-center gap-3.5">
            <Link
              href="/family"
              aria-label="Back to the family"
              className="flex size-11 items-center justify-center rounded-md bg-flour text-ink lg:hidden"
            >
              <Icon name="chevronLeft" size={20} />
            </Link>
            <Avatar
              name={selected.displayName}
              color={isAvatarColor(selected.color) ? selected.color : null}
              colorKey={selected.id}
              size={56}
            />
            <div className="flex min-w-0 flex-col">
              <h2 className="text-[30px]">{selected.displayName}</h2>
              <span className="text-ink-soft">{subtitle(data, selected, login)}</span>
            </div>
            <div className="ml-auto flex flex-wrap gap-3">
              {login === undefined && (
                <Link href={`/access?invite=${selected.id}`} className="text-sm font-extrabold">
                  Invite {selected.displayName}
                </Link>
              )}
              <Link href="/settings/detail-levels" className="text-sm font-extrabold">
                How detail levels work
              </Link>
            </div>
          </div>
          <Profile data={data} member={selected} onChanged={reload} />
          <TargetsSection
            key={`t-${JSON.stringify(data.targets.filter((t) => t.memberId === selected.id))}${JSON.stringify(data.tolerances.find((t) => t.memberId === selected.id))}`}
            data={data}
            member={selected}
            onChanged={reload}
          />
          <div className="grid gap-4 xl:grid-cols-2">
            <MealsSection data={data} member={selected} onChanged={reload} />
            <TrainingSection
              key={`tr-${JSON.stringify(data.schedules.training.filter((t) => t.memberId === selected.id))}`}
              data={data}
              member={selected}
              onChanged={reload}
            />
            <TastesSection data={data} member={selected} onChanged={reload} />
            <Section id="never-serve" title="Allergies & never-serve">
              <NeverServeList data={data} member={selected} onChanged={reload} />
            </Section>
          </div>
        </div>
      )}
    </div>
  );
}

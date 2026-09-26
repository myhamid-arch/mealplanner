// Typed errors of the reviews service (FBK-2).

/** The review (or reply parent) does not exist in this household. */
export class ReviewNotFoundError extends Error {
  constructor(readonly reviewId: string) {
    super(`review ${reviewId} not found`);
    this.name = "ReviewNotFoundError";
  }
}

/** A review's target, or its meal context, does not exist in this household or does not fit. */
export class ReviewTargetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReviewTargetError";
  }
}

/** The acting login may not do this (author-only edit, on-behalf-of rules). */
export class ReviewPermissionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReviewPermissionError";
  }
}

/** FBK-2: reviews are editable by their author for 24 h. */
export class ReviewEditWindowError extends Error {
  constructor(readonly reviewId: string) {
    super(`review ${reviewId} can no longer be edited (24 h after it was posted)`);
    this.name = "ReviewEditWindowError";
  }
}

/** The input breaks a review rule (rating range, empty review, tag length). */
export class ReviewValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReviewValidationError";
  }
}

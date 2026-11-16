/**
 * Route-Level Backtracking (Task 20.4)
 *
 * Backtracking is a property of the *route sequence*, not of an event type. The previous
 * implementation derived it from `blur`, `popstate` and `hashchange`, so a focus change on a
 * form field or an accordion collapse was recorded as the participant reversing course.
 *
 * The tracker keeps the pages actually visited, seeded with the page the session started on.
 * A deliberate navigation to a page that is already in that list, and that is not the page
 * the participant is on, is a reversal. Same-page acts — a click on the current page's own
 * navigation control, a blur, a disclosure toggle, a filter edit — never are.
 */

import type { CanonicalAction } from './canonical';

export interface BacktrackingObservation {
  /** True when this action moved to a previously visited page. */
  backtrack: boolean;
  /** Ordered, de-duplicated pages visited in this session. */
  visitedPages: string[];
  /** The page the session started on, when known. */
  startingPage?: string;
}

export class RouteBacktrackingTracker {
  private visited: string[] = [];
  private current?: string;
  private startingPage?: string;

  constructor(startingPage?: string) {
    this.reset(startingPage);
  }

  /** Re-seeds the tracker for a new session or trial. */
  public reset(startingPage?: string): void {
    this.startingPage = startingPage;
    this.current = startingPage;
    this.visited = startingPage ? [startingPage] : [];
  }

  /**
   * Observes one canonical action.
   *
   * Only a deliberate navigation with a known destination can be a reversal. Everything else
   * returns "no backtrack" and leaves the history untouched.
   */
  public observe(action: CanonicalAction): BacktrackingObservation {
    if (!this.isDeliberateNavigation(action)) {
      return this.observation(false);
    }

    const destination = action.route as string;
    // Staying on the page is not a reversal, however the participant got there.
    if (destination === this.current) {
      return this.observation(false);
    }

    const backtrack = this.visited.includes(destination);
    if (!this.visited.includes(destination)) {
      this.visited.push(destination);
    }
    this.current = destination;
    return this.observation(backtrack);
  }

  public getVisitedPages(): readonly string[] {
    return [...this.visited];
  }

  public getCurrentPage(): string | undefined {
    return this.current;
  }

  private isDeliberateNavigation(action: CanonicalAction): boolean {
    if (action.kind !== 'navigate') return false;
    if (action.systemInitiated) return false;
    return Boolean(action.route);
  }

  private observation(backtrack: boolean): BacktrackingObservation {
    return {
      backtrack,
      visitedPages: this.getVisitedPages() as string[],
      startingPage: this.startingPage
    };
  }
}

export type BotState = {
  readonly lot:      number;
  readonly round:    number;
  readonly myIndex:  number;
  readonly myStash:  number;
  readonly stashes:  readonly number[];
  readonly prevBids: readonly number[] | null;
  readonly prevLot:  number | null;
};

export type BotFn = (state: BotState) => number;

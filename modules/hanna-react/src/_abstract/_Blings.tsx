import React from 'react';
import { BlingType } from '@reykjavik/hanna-utils/assets';

import Bling, { BlingAlignment, BlingProps } from '../Bling.js';

type ConstrainedBlingProps = { type: BlingType } & Omit<BlingProps, 'type' | 'blingUrl'>;

export type BlingComboProps = [ConstrainedBlingProps, ...Array<ConstrainedBlingProps>];

const inverseAlignments: Record<BlingAlignment, BlingAlignment> = {
  left: 'right',
  'left-ish': 'right-ish',
  'left-center': 'right-center',
  'right-center': 'left-center',
  'right-ish': 'left-ish',
  right: 'left',
};

type BlingsProps = {
  blings: BlingComboProps;
  mirror?: boolean;
};

export const Blings = (props: BlingsProps) => (
  <>
    {props.blings.map(({ type, align, vertical, color, overlay, parent }, i) => (
      <Bling
        key={type + '-' + i}
        type={type}
        align={props.mirror ? inverseAlignments[align || 'left'] : align}
        vertical={vertical}
        color={color}
        overlay={overlay}
        parent={parent}
      />
    ))}
  </>
);

import type { ReactNode } from 'react';

import type { BuiltinIcon } from './schema';

/**
 * Layout primitives used to describe Live Activity UI.
 *
 * They are *descriptions*, not React Native views: a template's JSX is serialized to the
 * wire format and then drawn by SwiftUI (iOS Live Activity / Dynamic Island), Android Views /
 * RemoteViews (overlay island + notification) and the in-app React Native island.
 * Your own function components work too, as long as they only compose these primitives and
 * don't use hooks.
 */

export type ColorValue = string | number;
export type Align = 'start' | 'center' | 'end';
export type FontWeight = 'ultralight' | 'light' | 'regular' | 'medium' | 'semibold' | 'bold' | 'heavy';
export type TimeValue = Date | number;

export type Padding =
  | number
  | [vertical: number, horizontal: number]
  | [top: number, right: number, bottom: number, left: number]
  | { top?: number; right?: number; bottom?: number; left?: number; vertical?: number; horizontal?: number };

export interface BoxProps {
  padding?: Padding;
  background?: ColorValue;
  /** corner radius (also clips the content) */
  radius?: number;
  width?: number;
  height?: number;
  /** stretch horizontally to take all remaining space */
  fill?: boolean;
  opacity?: number;
}

export interface StackProps extends BoxProps {
  spacing?: number;
  /** cross-axis alignment */
  align?: Align;
  children?: ReactNode;
}

export interface TextStyleProps {
  size?: number;
  weight?: FontWeight;
  color?: ColorValue;
  align?: Align;
  /** SF Rounded on iOS, best-effort elsewhere */
  rounded?: boolean;
}

export interface TextProps extends BoxProps, TextStyleProps {
  lines?: number;
  /** tabular digits — keeps numbers from jittering while they change */
  monospacedDigits?: boolean;
  children?: ReactNode;
}

export interface IconProps extends BoxProps {
  /** built-in cross-platform alias (e.g. "play", "car") or any SF Symbol name */
  name: BuiltinIcon | (string & {});
  /** Android drawable resource name to use instead (e.g. "ic_my_logo" in res/drawable) */
  android?: string;
  size?: number;
  color?: ColorValue;
}

export interface ImageProps extends BoxProps {
  /** iOS: image in the widget extension asset catalog (plugin `images` option). Android: drawable name. */
  name: string;
  fit?: 'fill' | 'fit';
}

export interface SpacerProps {
  /** minimum length */
  size?: number;
}

export interface ProgressProps extends BoxProps {
  variant?: 'bar' | 'ring';
  /** 0..1 */
  value?: number;
  /** time-based progress: animates by itself between start and end, no updates needed */
  start?: TimeValue;
  end?: TimeValue;
  color?: ColorValue;
  trackColor?: ColorValue;
  /** ring diameter */
  size?: number;
  thickness?: number;
}

export interface TimerProps extends BoxProps, TextStyleProps {
  /** count down to this moment */
  to?: TimeValue;
  /** count up from this moment */
  from?: TimeValue;
}

export type PrimitiveKind = 'v' | 'h' | 'z' | 'tx' | 'ic' | 'im' | 'sp' | 'pg' | 'tm';

type Primitive<P> = ((props: P) => null) & { __di: PrimitiveKind; displayName: string };

function primitive<P>(kind: PrimitiveKind, displayName: string): Primitive<P> {
  const component = (() => {
    if ((globalThis as { __DEV__?: boolean }).__DEV__) {
      console.warn(
        `[dynamic-island] <${displayName}> was rendered directly. Use it inside a Live Activity template, ` +
          'or render the template with <LiveActivityPreview />.',
      );
    }
    return null;
  }) as unknown as Primitive<P>;
  component.__di = kind;
  component.displayName = displayName;
  return component;
}

export const VStack = primitive<StackProps>('v', 'VStack');
export const HStack = primitive<StackProps>('h', 'HStack');
/** Overlays children on top of each other */
export const ZStack = primitive<StackProps>('z', 'ZStack');
export const Text = primitive<TextProps>('tx', 'Text');
export const Icon = primitive<IconProps>('ic', 'Icon');
export const Image = primitive<ImageProps>('im', 'Image');
export const Spacer = primitive<SpacerProps>('sp', 'Spacer');
export const Progress = primitive<ProgressProps>('pg', 'Progress');
export const Timer = primitive<TimerProps>('tm', 'Timer');

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { argbToCss, toArgb } from '../color';
import { HStack, Icon, Progress, Spacer, Text, Timer, VStack, ZStack } from '../primitives';
import { serialize } from '../serialize';
import { createIslandStore } from '../store';
import { byteLength, encodePayload, renderTemplate, type LiveActivityTemplate } from '../template';

test('colors normalise to unsigned ARGB', () => {
  assert.equal(toArgb('#fff'), 0xffffffff);
  assert.equal(toArgb('#FF000080'), 0x80ff0000);
  assert.equal(toArgb('rgba(0, 122, 255, 0.5)'), 0x80007aff);
  assert.equal(toArgb('green'), 0xff34c759);
  assert.equal(argbToCss(0x80ff0000), 'rgba(255, 0, 0, 0.502)');
  assert.throws(() => toArgb('not-a-color'));
});

test('primitives serialize to the compact wire format', () => {
  const node = serialize(
    <HStack spacing={4} align="start" padding={[2, 8]} background="#000">
      <Icon name="car" color="#34c759" />
      <Text size={13} weight="semibold" monospacedDigits>
        ETA {5} min
      </Text>
      <Spacer />
      {false}
      {null}
    </HStack>,
  );
  assert.deepEqual(node, {
    t: 'h',
    sp: 4,
    a: 's',
    p: [2, 8, 2, 8],
    bg: 0xff000000,
    fx: 1,
    c: [
      { t: 'ic', n: 'car.fill', s: 16, fc: 0xff34c759 },
      { t: 'tx', v: 'ETA 5 min', fs: 13, fw: 'sb', mo: 1 },
      { t: 'sp' },
    ],
  });
});

test('user components and fragments are flattened', () => {
  const Badge = ({ label }: { label: string }) => (
    <>
      <Text>{label}</Text>
      <Text>!</Text>
    </>
  );
  const node = serialize(
    <VStack>
      <Badge label="hi" />
    </VStack>,
  );
  assert.deepEqual(node, { t: 'v', sp: 6, c: [{ t: 'tx', v: 'hi', fs: 15 }, { t: 'tx', v: '!', fs: 15 }] });
});

test('several top-level nodes are wrapped in a VStack; nothing renders to undefined', () => {
  assert.equal(serialize(null), undefined);
  assert.equal(serialize(<>{false}</>), undefined);
  const node = serialize([<Text key="a">a</Text>, <Text key="b">b</Text>]);
  assert.equal(node?.t, 'v');
});

test('time-based progress and timers keep epoch ms', () => {
  const start = new Date(1_000);
  const end = new Date(61_000);
  assert.deepEqual(serialize(<Progress variant="ring" start={start} end={end} />), { t: 'pg', k: 'ring', f: 1000, e: 61000, s: 20, lw: 3 });
  assert.deepEqual(serialize(<Progress value={1.5} />), { t: 'pg', k: 'bar', v: 1, lw: 4 });
  assert.deepEqual(serialize(<Timer to={end} size={20} />), { t: 'tm', e: 61000, fs: 20 });
  assert.throws(() => serialize(<Timer />), /needs either/);
});

test('ZStack has no spacing, unsupported elements throw', () => {
  assert.deepEqual(serialize(<ZStack align="end"><Text>x</Text></ZStack>), { t: 'z', a: 'e', c: [{ t: 'tx', v: 'x', fs: 15 }] });
  assert.throws(() => serialize(<div />), /Unsupported element/);
  assert.throws(() => serialize(<Text><HStack /></Text>), /only contain strings/);
});

test('renderTemplate fills every surface and stays small', () => {
  type D = { title: string; progress: number };
  const template: LiveActivityTemplate<D> = {
    name: 'upload',
    compact: { leading: () => <Icon name="upload" />, trailing: (d) => <Text>{Math.round(d.progress * 100)}%</Text> },
    expanded: { center: (d) => <Text>{d.title}</Text>, bottom: (d) => <Progress value={d.progress} /> },
    lockScreen: (d) => (
      <VStack align="start">
        <Text weight="bold">{d.title}</Text>
        <Progress value={d.progress} />
      </VStack>
    ),
    style: { background: '#111', textColor: 'white' },
    url: (d) => `myapp://upload/${encodeURIComponent(d.title)}`,
  };
  const payload = renderTemplate(template, { title: 'photo.jpg', progress: 0.42 });
  assert.equal(payload.v, 1);
  assert.deepEqual(payload.cp?.t, { t: 'tx', v: '42%', fs: 15 });
  assert.equal(payload.ex?.l, undefined);
  assert.equal(payload.ex?.c?.t, 'tx');
  assert.deepEqual(payload.st, { bg: 0xff111111, fc: 0xffffffff });
  assert.equal(payload.url, 'myapp://upload/photo.jpg');
  assert.ok(!('mn' in payload));
  assert.ok(byteLength(encodePayload(payload)) < 600);
});

test('byteLength counts UTF-8 bytes (Vietnamese text, emoji)', () => {
  assert.equal(byteLength('abc'), 3);
  assert.equal(byteLength('Đang giao'), 10);
  assert.equal(byteLength('🚗'), 4);
});

test('store orders by priority then recency and notifies subscribers', () => {
  const store = createIslandStore();
  let calls = 0;
  const unsubscribe = store.subscribe(() => calls++);
  const base = { name: 'x', payload: { v: 1 as const }, nativeOverlay: false };
  store.upsert({ ...base, id: 'a', priority: 0, startedAt: 1 });
  store.upsert({ ...base, id: 'b', priority: 0, startedAt: 2 });
  store.upsert({ ...base, id: 'c', priority: 5, startedAt: 0 });
  assert.deepEqual(store.getSnapshot().map((e) => e.id), ['c', 'b', 'a']);
  store.patch('a', { priority: 10 });
  assert.equal(store.getSnapshot()[0]?.id, 'a');
  store.remove('c');
  store.remove('missing');
  assert.equal(store.getSnapshot().length, 2);
  assert.equal(calls, 5);
  unsubscribe();
  store.clear();
  assert.equal(calls, 5);
});

test('store tracks the expanded activity and clears it on removal', () => {
  const store = createIslandStore();
  const base = { name: 'x', payload: { v: 1 as const }, nativeOverlay: false, priority: 0, startedAt: 0 };
  store.upsert({ ...base, id: 'a' });
  store.setExpanded('a');
  assert.equal(store.getExpanded(), 'a');
  store.remove('a');
  assert.equal(store.getExpanded(), null);
});

test('greedy children make their stacks fill, like SwiftUI', () => {
  const node = serialize(
    <VStack>
      <HStack>
        <Text>a</Text>
        <Progress value={0.5} />
      </HStack>
      <VStack>
        <Spacer />
      </VStack>
      <HStack width={100}>
        <Spacer />
      </HStack>
    </VStack>,
  ) as { fx?: number; c: { fx?: number }[] };
  assert.equal(node.fx, 1);
  assert.equal(node.c[0]?.fx, 1);
  assert.equal(node.c[1]?.fx, undefined); // vertical spacer only grows vertically
  assert.equal(node.c[2]?.fx, undefined); // fixed width wins
});

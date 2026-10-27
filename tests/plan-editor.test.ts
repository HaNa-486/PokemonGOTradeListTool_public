import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {PlanEditor} from '../app/plan-editor';
import type {Circle,Listing} from '../core/model';

test('stale offer supply cannot crash matching or submit an invisible selection',()=>{
  const circle={id:'circle',members:{a:{status:'active'},b:{status:'active'}},fast:false} as unknown as Circle;
  const request={id:'request',owner:'b',intent:'request',species:'10001',status:'active',shares:['circle'],traits:{form:{mode:'ANY'},shiny:{mode:'ANY'},size:{mode:'ANY'},state:{mode:'ANY'},costume:{mode:'ANY'}}} as unknown as Listing;
  const html=renderToStaticMarkup(createElement(PlanEditor,{circle,me:'a',members:[{id:'b',displayName:'B'}],listings:[request],offer:{other:'b',supply:'no-longer-visible'},disabled:false,submit:()=>assert.fail('Render must not submit')}));
  assert.match(html,/這筆供給已不可用/);
  assert.match(html,/<button class="primary" disabled="">送出主動提案/);
  assert.match(html,/aria-label="分配給需求" disabled=""/);
});

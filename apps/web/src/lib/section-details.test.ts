import {expect, test} from 'vitest';
import {normalizeSectionDetails, sectionType} from './section-details';

test('meeting details distinguish lecture/discussion and preserve room and exact campus time', () => {
  const detail = normalizeSectionDetails({sections: [
    {type: 'LEC', sectionNumber: '001', instructors: [{name: {first: 'Casey', last: 'Lee'}}], classMeetings: [{meetingType: 'CLASS', meetingDays: 'TR', meetingTimeStart: (360 + 570) * 60000, meetingTimeEnd: (360 + 645) * 60000, room: '114', building: {buildingCode: '0048', buildingName: 'Van Vleck Hall'}}]},
    {type: 'DIS', sectionNumber: '301', classMeetings: [{meetingType: 'CLASS', meetingDays: 'W', meetingTimeStart: (360 + 465) * 60000, meetingTimeEnd: (360 + 515) * 60000}]},
  ]});
  expect(detail).toHaveLength(3);
  expect(detail[0]).toMatchObject({type: 'LEC', section: '001', day: 'TUE', start_min: 570, end_min: 645, room: '114', building: 'Van Vleck Hall', instructors: ['Casey Lee']});
  expect(detail[2]).toMatchObject({type: 'DIS', section: '301', day: 'WED', start_min: 465, end_min: 515});
  expect(sectionType(detail[2].type)).toBe('Discussion');
  expect(normalizeSectionDetails({sections: [{classMeetings: [{meetingType: 'EXAM'}]}]})).toEqual([]);
});

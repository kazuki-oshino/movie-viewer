import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { BookmarkEditor } from './BookmarkEditor';

it('既存の地点を区間に変更し、不正なBを拒否し、地点へ戻せる', async () => {
  const user = userEvent.setup();
  const onSave = vi.fn().mockRejectedValue(new Error('保存に失敗'));
  render(
    <BookmarkEditor
      draft={{
        kind: 'edit',
        id: 'a',
        videoId: 'v',
        videoTitle: 'デモ',
        seconds: 10,
        duration: 90,
        thumbnail: '',
        note: '練習',
        color: 'sage',
      }}
      onSave={onSave}
      onClose={() => {}}
    />,
  );
  expect(screen.getByRole('radio', { name: '地点から再生' })).toBeChecked();
  await user.click(screen.getByRole('radio', { name: 'A–B区間リピート' }));
  const end = screen.getByRole('spinbutton', { name: 'B（終点・秒）' });
  for (const value of ['', '10', '10.4', '91']) {
    await user.clear(end);
    if (value) await user.type(end, value);
    expect(screen.getByRole('button', { name: /変更を保存/ })).toBeDisabled();
  }
  await user.clear(end);
  await user.type(end, '10.5');
  await user.click(screen.getByRole('button', { name: /変更を保存/ }));
  expect(onSave).toHaveBeenLastCalledWith('練習', 'sage', 10.5, {
    brightness: 1,
    contrast: 1,
    saturation: 1,
  });
  expect(await screen.findByRole('alert')).toHaveTextContent('保存に失敗');
  expect(end).toHaveValue(10.5);
  await user.click(screen.getByRole('radio', { name: '地点から再生' }));
  await user.click(screen.getByRole('button', { name: /変更を保存/ }));
  expect(onSave).toHaveBeenLastCalledWith('練習', 'sage', null, {
    brightness: 1,
    contrast: 1,
    saturation: 1,
  });
});

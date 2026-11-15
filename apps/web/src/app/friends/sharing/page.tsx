import {redirect} from 'next/navigation';

/** Old sharing links now lead to the friend request and acceptance screen. */
export default function SharingPage() {
  redirect('/friends');
}

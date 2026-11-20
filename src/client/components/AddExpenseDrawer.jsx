import React from 'react';
import { ExpenseFormView } from './ExpenseFormView.jsx';

export { ExpenseFormView };

export function AddExpenseDrawer(props) {
  if (!props.isOpen) return null;
  return <ExpenseFormView {...props} onBack={props.onClose} />;
}

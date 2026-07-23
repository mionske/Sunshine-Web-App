// Maps QuickBooks' raw API entity shapes onto this app's mirror-tab row
// shapes. Deliberately loose input types — QB's actual objects carry many
// more fields than this app mirrors, and plenty of them are optional.
import type { QBCustomer } from '../models/qbCustomer';
import type { QBEstimate } from '../models/qbEstimate';
import type { QBInvoice } from '../models/qbInvoice';
import type { QBPayment } from '../models/qbPayment';

export interface RawQBCustomer {
	Id: string;
	DisplayName?: string;
	PrimaryEmailAddr?: { Address?: string };
	PrimaryPhone?: { FreeFormNumber?: string };
	BillAddr?: { Line1?: string; City?: string; CountrySubDivisionCode?: string; PostalCode?: string };
	MetaData?: { LastUpdatedTime?: string };
}

export interface RawQBEstimate {
	Id: string;
	TxnStatus?: string;
	TotalAmt?: number;
	DocNumber?: string;
	TxnDate?: string;
	CustomerRef?: { value?: string };
	MetaData?: { LastUpdatedTime?: string };
}

export interface RawQBInvoice {
	Id: string;
	TotalAmt?: number;
	Balance?: number;
	DueDate?: string;
	DocNumber?: string;
	TxnDate?: string;
	CustomerRef?: { value?: string };
	MetaData?: { LastUpdatedTime?: string };
}

export interface RawQBPayment {
	Id: string;
	TotalAmt?: number;
	TxnDate?: string;
	CustomerRef?: { value?: string };
	PaymentMethodRef?: { name?: string; value?: string };
	Line?: Array<{ LinkedTxn?: Array<{ TxnId?: string }> }>;
	MetaData?: { LastUpdatedTime?: string };
}

function flattenAddress(addr?: RawQBCustomer['BillAddr']): string {
	if (!addr) return '';
	return [addr.Line1, addr.City, addr.CountrySubDivisionCode, addr.PostalCode].filter(Boolean).join(', ');
}

export function mapCustomer(raw: RawQBCustomer): Partial<QBCustomer> {
	return {
		'QB Customer ID': raw.Id,
		'Display Name': raw.DisplayName ?? '',
		Email: raw.PrimaryEmailAddr?.Address ?? '',
		Phone: raw.PrimaryPhone?.FreeFormNumber ?? '',
		Address: flattenAddress(raw.BillAddr),
		'QB Last Updated': raw.MetaData?.LastUpdatedTime ?? '',
	};
}

export function mapEstimate(raw: RawQBEstimate): Partial<QBEstimate> {
	return {
		'QB Estimate ID': raw.Id,
		'QB Customer ID': raw.CustomerRef?.value ?? '',
		Status: raw.TxnStatus ?? '',
		Total: raw.TotalAmt !== undefined ? String(raw.TotalAmt) : '',
		'Doc Number': raw.DocNumber ?? '',
		'Txn Date': raw.TxnDate ?? '',
		'QB Last Updated': raw.MetaData?.LastUpdatedTime ?? '',
	};
}

/** Invoice status isn't a single field QB returns — derived from
 * Balance/DueDate the same way SunshineTool did it. */
export function deriveInvoiceStatus(balance: number, dueDate: string, today: string): string {
	if (balance <= 0) return 'Paid';
	if (dueDate && dueDate < today) return 'Overdue';
	return 'Open';
}

export function mapInvoice(raw: RawQBInvoice, today: string): Partial<QBInvoice> {
	const balance = raw.Balance ?? 0;
	return {
		'QB Invoice ID': raw.Id,
		'QB Customer ID': raw.CustomerRef?.value ?? '',
		Status: deriveInvoiceStatus(balance, raw.DueDate ?? '', today),
		Total: raw.TotalAmt !== undefined ? String(raw.TotalAmt) : '',
		Balance: String(balance),
		'Due Date': raw.DueDate ?? '',
		'Doc Number': raw.DocNumber ?? '',
		'Txn Date': raw.TxnDate ?? '',
		'QB Last Updated': raw.MetaData?.LastUpdatedTime ?? '',
	};
}

export function mapPayment(raw: RawQBPayment): Partial<QBPayment> {
	const linkedInvoiceIds = (raw.Line ?? [])
		.flatMap((line) => line.LinkedTxn ?? [])
		.map((txn) => txn.TxnId)
		.filter((id): id is string => Boolean(id));

	return {
		'QB Payment ID': raw.Id,
		'QB Customer ID': raw.CustomerRef?.value ?? '',
		Total: raw.TotalAmt !== undefined ? String(raw.TotalAmt) : '',
		'Payment Date': raw.TxnDate ?? '',
		Method: raw.PaymentMethodRef?.name ?? raw.PaymentMethodRef?.value ?? '',
		'Linked Invoice IDs': [...new Set(linkedInvoiceIds)].join(', '),
		'QB Last Updated': raw.MetaData?.LastUpdatedTime ?? '',
	};
}

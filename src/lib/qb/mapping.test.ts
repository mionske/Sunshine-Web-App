import { describe, expect, it } from 'vitest';
import { deriveInvoiceStatus, mapCustomer, mapEstimate, mapInvoice, mapPayment } from './mapping';

describe('mapCustomer', () => {
	it('flattens the billing address and pulls email/phone', () => {
		const mapped = mapCustomer({
			Id: '1',
			DisplayName: 'Jane Doe',
			PrimaryEmailAddr: { Address: 'jane@example.com' },
			PrimaryPhone: { FreeFormNumber: '303-555-1234' },
			BillAddr: { Line1: '123 Main St', City: 'Boulder', CountrySubDivisionCode: 'CO', PostalCode: '80301' },
			MetaData: { LastUpdatedTime: '2026-01-01T00:00:00Z' },
		});
		expect(mapped['Display Name']).toBe('Jane Doe');
		expect(mapped.Email).toBe('jane@example.com');
		expect(mapped.Phone).toBe('303-555-1234');
		expect(mapped.Address).toBe('123 Main St, Boulder, CO, 80301');
	});

	it('leaves fields blank rather than throwing when optional data is missing', () => {
		const mapped = mapCustomer({ Id: '2' });
		expect(mapped['Display Name']).toBe('');
		expect(mapped.Email).toBe('');
		expect(mapped.Address).toBe('');
	});
});

describe('deriveInvoiceStatus', () => {
	it('is Paid when balance is zero or less', () => {
		expect(deriveInvoiceStatus(0, '2026-01-01', '2026-06-01')).toBe('Paid');
		expect(deriveInvoiceStatus(-5, '2026-01-01', '2026-06-01')).toBe('Paid');
	});

	it('is Overdue when balance remains and the due date has passed', () => {
		expect(deriveInvoiceStatus(100, '2026-01-01', '2026-06-01')).toBe('Overdue');
	});

	it('is Open when balance remains and the due date has not passed', () => {
		expect(deriveInvoiceStatus(100, '2026-12-01', '2026-06-01')).toBe('Open');
	});

	it('is Open when there is no due date at all', () => {
		expect(deriveInvoiceStatus(100, '', '2026-06-01')).toBe('Open');
	});
});

describe('mapEstimate / mapInvoice / mapPayment', () => {
	it('maps an estimate', () => {
		const mapped = mapEstimate({ Id: '10', TxnStatus: 'Pending', TotalAmt: 250.5, DocNumber: 'E-1', TxnDate: '2026-01-05', CustomerRef: { value: '5' } });
		expect(mapped).toMatchObject({ 'QB Estimate ID': '10', 'QB Customer ID': '5', Status: 'Pending', Total: '250.5', 'Doc Number': 'E-1', 'Txn Date': '2026-01-05' });
	});

	it('maps an invoice with a derived status', () => {
		const mapped = mapInvoice({ Id: '20', TotalAmt: 300, Balance: 0, DueDate: '2026-01-01', CustomerRef: { value: '5' } }, '2026-06-01');
		expect(mapped.Status).toBe('Paid');
		expect(mapped.Balance).toBe('0');
	});

	it('maps a payment and dedupes/joins linked invoice IDs', () => {
		const mapped = mapPayment({
			Id: '30',
			TotalAmt: 300,
			TxnDate: '2026-01-10',
			CustomerRef: { value: '5' },
			PaymentMethodRef: { name: 'Check' },
			Line: [{ LinkedTxn: [{ TxnId: '20' }] }, { LinkedTxn: [{ TxnId: '20' }, { TxnId: '21' }] }],
		});
		expect(mapped['Linked Invoice IDs']).toBe('20, 21');
		expect(mapped.Method).toBe('Check');
	});
});

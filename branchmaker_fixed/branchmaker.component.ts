import { Component, OnInit, ViewChild, HostListener, ChangeDetectorRef, AfterViewInit } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { DatePipe, CommonModule } from '@angular/common';
import * as XLSX from 'xlsx';
import { AuthenticationService } from '../../../services/security/authentication.service';
import { environment } from 'src/environments/environment';
import { MatSort } from '@angular/material/sort';
import { CURRENCYMODE } from 'src/models/fcny-module/currencymode';
import { RandomNumberGeneratorService } from 'src/services/fcny-services/random-number-generator.service';
import { MatTabsModule } from '@angular/material/tabs';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'rfm-branchmaker',
  standalone: true,
  templateUrl: './branchmaker.component.html',
  styleUrls: ['./branchmaker.component.css'],
  imports: [CommonModule, MatTabsModule, FormsModule]
})
export class BranchmakerComponent implements OnInit, AfterViewInit {
  @ViewChild(MatSort) sort!: MatSort;

  // order model
  orderData = {
    bcode: '',
    branchmail: '',
    branchname: '',
    declaration_check: false,
    request_date: '',
    makercode: 0,
    makerName: '',
    status: 0,
    entries: [] as any[],
  };

  // UI & state
  submitted = false;
  date = new Date();
  applicationReturnStatusMessage = '';
  activeTabIndex = 0;

  // Data collections (initialized defensively)
  branchIndents: any[] = [];
  branchIndents1: any[] = [];
  appStatus: string[] = [];
  responseData: any = null;
  records: any[] = [];
  completedRecords: any[] = [];
  uniqueIndents: string[] = [];
  uniqueIndentCount: { [key: string]: number } = {};
  firstIndexMap: { [key: string]: number } = {};
  vendorDetails: any[] = [];
  currencyMode: { [key: string]: string } = CURRENCYMODE;
  selectedCurrency = '';
  currencyData: { [key: string]: string } = {};
  vendorArray: any[] = [];
  branchEmailRecords: any[] = [];
  branchVendorMappingDetails: any = {};
  localBranchName = '';
  globalUserDetails: any = null;
  userName = '';

  // secondary dropdown
  branchVendorMappingDetailsData: any = { branchVendors: [] };
  branchVendorList: { [key: string]: string } = {};
  vendors: Array<{ vendorName: string; locationName: string; emails: string }> = [];
  isDropdownOpen = false;
  selectedValue: string | null = null;
  hoveredKey: string | null = null;
  subMenuItems: { [key: string]: string } = {};
  subMenuItemsArray: Array<{ [key: string]: string }> = [];
  subMenuItemsArrayLength: number[] = [];

  displayedColumns: string[] = ['sno', 'indentID', 'branchCode', 'branchName', 'vendorName', 'currency', 'requestedCurrencyValue', 'requestedDate', 'receivedCurrencyValue', 'receivedDate', 'status'];

  // rows for creation (always keep at least one)
  createRows: any[] = [this.emptyRow()];

  // colors
  colors = [
    '#F7D1CD', '#E3F1D1', '#D1F0F4', '#EAD1F7', '#F7F1D1',
    '#FFD700', '#FF6347', '#90EE90', '#ADD8E6', '#FFB6C1',
    '#FAFAD2', '#D8BFD8', '#E0FFFF', '#F5FFFA', '#FFDEAD',
    '#F4A300', '#A7F2D1'
  ];

  colorMap: { [key: string]: string } = {};
  previousColorIndex = -1;

  constructor(
    private http: HttpClient,
    private router: Router,
    private datePipe: DatePipe,
    private authenticationService: AuthenticationService,
    private randomNumberService: RandomNumberGeneratorService,
    private cdr: ChangeDetectorRef
  ) {}

  // helper to produce a blank row
  emptyRow() {
    return {
      currency: null,
      currency_mode: '',
      vendor_name: '',
      exchange: '',
      vendor_email: '',
      vendor_branch: '',
    };
  }

  ngOnInit(): void {
    const today = new Date().toLocaleDateString();

    this.orderData.bcode = this.getBranchCode();
    this.userName = this.getUserName();

    this.orderData.branchname = this.getBranchName();
    this.localBranchName = this.orderData.branchname;
    this.orderData.makercode = Number(this.authenticationService.getFcnEmpid?.() ?? 0);
    this.orderData.request_date = today;
    this.orderData.makerName = this.userName;

    // app status map
    this.appStatus = [];
    this.appStatus[1] = 'Created by Maker';
    this.appStatus[2] = 'Approved by checker';
    this.appStatus[3] = 'Rejected by checker';
    this.appStatus[4] = 'Currency Partially Received';
    this.appStatus[5] = 'Currency Received';

    const storedResponse = sessionStorage.getItem('applicationReturnStatusMessage');
    if (storedResponse) {
      this.responseData = JSON.parse(storedResponse);
      sessionStorage.removeItem('applicationReturnStatusMessage');
    }

    // fetch required data in parallel (defensive)
    this.fetchInitialData();
  }

  ngAfterViewInit(): void {
    if (this.completedRecords) {
      try {
        // MatSort wiring if using MatTable elsewhere
      } catch (err) {
        // ignore
      }
    }
  }

  /* -------------------- Data fetching -------------------- */
  fetchInitialData() {
    this.getCurrencyDetails();
    this.getBranchMail();
    this.getBranchVendorMappingDetailsData();
    this.fetchRecords();
    this.fetchBranchEmailsList();
  }

  fetchRecords(): void {
    const apiUrl = `${environment.rfmIndentService}/getBranchIndents?bcode=${this.orderData.bcode}`;
    this.http.get<any[]>(apiUrl).subscribe(
      (data) => {
        const arr = Array.isArray(data) ? data : [];
        this.records = arr.filter(entry => entry.indentStatus <= 4);
        this.completedRecords = arr.filter(entry => entry.indentStatus === 5);
        this.getUniqueValues();
        this.uniqueIndentCount = this.getUniqueIndentCounts(this.records);
        this.calculateFirstIndex(this.records);
        this.cdr.detectChanges();
      },
      (error) => {
        console.error('Error fetching records:', error);
      }
    );
  }

  fetchBranchEmailsList(): void {
    const apiUrl = `${environment.rfmIndentService}/getMailsOfABranch?bcode=${this.orderData.bcode}`;
    this.http.get<any[]>(apiUrl).subscribe(
      (data) => {
        this.branchEmailRecords = Array.isArray(data) ? data : [];
      },
      (error) => {
        console.error('Error fetching branch emails:', error);
      }
    );
  }

  getBranchMail() {
    const apiUrl = `${environment.rfmIndentService}/getBranchEmail?bcode=${this.orderData.bcode}`;
    this.http.get(apiUrl, { responseType: 'text' }).subscribe(
      (data) => {
        this.orderData.branchmail = data ?? '';
      },
      (error) => {
        console.error('Error fetching branch mail:', error);
      }
    );
  }

  getCurrencyDetails() {
    const apiUrl = `${environment.rfmIndentService}/findCurrencyDetails`;
    this.http.get(apiUrl).subscribe(
      (data: any) => {
        if (data && typeof data === 'object') {
          this.currencyData = { ...data };
        }
      },
      (error) => {
        console.error('Error fetching currency details:', error);
      }
    );
  }

  getBranchVendorMappingDetailsData() {
    const apiUrl = `${environment.rfmIndentService}/getBranchVendorMappingData?bcode=${this.orderData.bcode}`;
    this.http.get(apiUrl).subscribe(
      (data: any) => {
        this.branchVendorMappingDetailsData = data ?? { branchVendors: [] };

        // build branchVendorList and vendors array defensively
        this.branchVendorList = {};
        this.vendors = [];

        const branchVendors = Array.isArray(this.branchVendorMappingDetailsData.branchVendors)
          ? this.branchVendorMappingDetailsData.branchVendors : [];

        branchVendors.forEach((obj: any) => {
          const key = Object.keys(obj)[0];
          const value = obj[key];
          this.branchVendorList[key] = value;
        });

        branchVendors.forEach((vendor: any) => {
          const key = Object.keys(vendor)[0];
          const vendorName = vendor[key];
          const locations = this.branchVendorMappingDetailsData[key] ?? [];
          locations.forEach((location: any) => {
            const locationName = Object.keys(location)[0];
            const emails = location[locationName];
            this.vendors.push({ vendorName, locationName, emails });
          });
        });

      },
      (error) => {
        console.error('Error fetching branch vendor mapping data:', error);
      }
    );
  }

  /* -------------------- Utilities & UI -------------------- */
  addRow() {
    this.createRows = [...this.createRows, this.emptyRow()];
    this.subMenuItemsArray.push({});
    this.subMenuItemsArrayLength.push(0);
    this.cdr.detectChanges();
  }

  removeRow(index: number) {
    if (this.createRows.length > 1) {
      this.createRows = this.createRows.filter((_, i) => i !== index);
      this.subMenuItemsArray.splice(index, 1);
      this.subMenuItemsArrayLength.splice(index, 1);
      this.cdr.detectChanges();
    }
  }

  trackByIndent(index: number, item: any) {
    return item?.indentID ?? index;
  }

  trackByRow(index: number, item: any) {
    // Use a stable identifier when possible
    return item?.vendor_name + '|' + item?.vendor_branch + '|' + index;
  }

  onSelectChange(value: string, rownumber: number) {
    const data = this.branchVendorMappingDetailsData ?? {};
    const raw = data[value] ?? [];

    // Convert array-of-objects to map
    const map: { [key: string]: string } = {};
    if (Array.isArray(raw)) {
      raw.forEach((obj: any) => {
        const k = Object.keys(obj)[0];
        const v = obj[k];
        map[k] = v;
      });
    }

    this.subMenuItemsArray[rownumber] = map;
    this.subMenuItemsArrayLength[rownumber] = Object.keys(map).length;

    // reset fields
    if (this.createRows[rownumber]) {
      this.createRows[rownumber].vendor_email = '';
      this.createRows[rownumber].vendor_branch = '';
    }
  }

  onSelectSubMenuChange(value: string, rownumber: number) {
    const vendorItems = this.subMenuItemsArray[rownumber] ?? {};
    const v = vendorItems[value] ?? '';
    if (this.createRows[rownumber]) {
      this.createRows[rownumber].vendor_email = (v || '').replace(/(?:\r\n|,)/g, '\n');
    }
  }

  disableMinus(event: KeyboardEvent) {
    const allowedKeys = ['0','1','2','3','4','5','6','7','8','9','Backspace','Tab','ArrowLeft','ArrowRight'];
    if (!allowedKeys.includes(event.key)) {
      event.preventDefault();
    }
  }

  exportToExcel(tableId = 'table_print', filePrefix = 'Indents') {
    const table = document.getElementById(tableId) as HTMLTableElement | null;
    if (!table) return;
    const ws: XLSX.WorkSheet = XLSX.utils.table_to_sheet(table);
    const wb: XLSX.WorkBook = { Sheets: { 'Sheet1': ws }, SheetNames: ['Sheet1'] };
    XLSX.writeFile(wb, `${filePrefix} - ${this.orderData.bcode}-${this.localBranchName}.xlsx`);
  }

  exportToExcelCompleted() { this.exportToExcel('table_print_completed', 'Completed Indents'); }
  exportToExcelVendorDetails() { this.exportToExcel('table_vendor_list', 'Vendor Mapping Details'); }
  exportToExcelMailingList() { this.exportToExcel('table_mailing_list', 'Mailing List'); }

  onSubmit(form: any) {
    if (!form.valid) return;
    this.submitted = true;

    if (!window.confirm('Are you sure to submit the indent ??')) return;

    // normalize emails
    this.createRows.forEach(item => {
      item.vendor_email = (item.vendor_email || '').replace(/\n/g, ',');
    });

    this.orderData.entries = this.createRows;
    this.orderData.status = 1;

    this.http.post(`${environment.rfmIndentService}/saveBranchIndent`, this.orderData).subscribe((response: any) => {
      this.applicationReturnStatusMessage = response?.applicationReturnStatusMessage ?? '';
      sessionStorage.setItem('applicationReturnStatusMessage', JSON.stringify(this.applicationReturnStatusMessage));
      this.router.navigateByUrl('/', { skipLocationChange: true }).then(() => {
        this.router.navigate(['/fcnBranchMaker']);
      });
    }, (err) => {
      console.error('Save indent failed', err);
    });
  }

  convertHRF(dt: string) {
    return this.datePipe.transform(dt, 'dd-MM-yyyy hh:mm aa');
  }

  calculateFirstIndex(records: any[]) {
    this.firstIndexMap = {};
    records.forEach((record, index) => {
      if (this.firstIndexMap[record.indentID] === undefined) {
        this.firstIndexMap[record.indentID] = index;
      }
    });
  }

  getRowColor(indentID: string) {
    if (!indentID) return this.colors[0];
    if (!this.colorMap[indentID]) {
      let colorIndex: number;
      do {
        colorIndex = this.randomNumberService.generateRandomNumber(this.colors.length);
      } while (colorIndex === this.previousColorIndex);
      this.colorMap[indentID] = this.colors[colorIndex];
      this.previousColorIndex = colorIndex;
    }
    return this.colorMap[indentID];
  }

  getUniqueValues() {
    this.uniqueIndents = Array.from(new Set(this.records.map(record => record['indentID'])));
  }

  getUniqueIndentCounts(records: any[]): { [key: string]: number } {
    const indentCountsMap = new Map<string, number>();
    records.forEach(record => {
      const indentId = record.indentID;
      indentCountsMap.set(indentId, (indentCountsMap.get(indentId) || 0) + 1);
    });
    const result: { [key: string]: number } = {};
    indentCountsMap.forEach((count, indent_id) => result[indent_id] = count);
    return result;
  }

  onCheckBoxChange(event: Event) {
    this.orderData.declaration_check = !!(event.target as HTMLInputElement).checked;
  }

  onClickModify(id: string) { this.router.navigate(['/fcnBranchIndentEdit', id]); }
  onClickModifyRTO(id: number) { this.router.navigate(['/fcnBranchIndentModifyRTO', id]); }

  getBranchCode(): string { return this.authenticationService.getFcnBcode?.() ?? ''; }
  getBranchName(): string { return this.authenticationService.getFcnBname?.() ?? ''; }
  getUserName(): string { return this.authenticationService.getFcnName?.() ?? ''; }

  // dropdown helpers
  toggleDropdown() { this.isDropdownOpen = !this.isDropdownOpen; }
  closeDropdown() { this.isDropdownOpen = false; }
  selectOption(option: any, rownumber: number) {
    this.selectedValue = option.label || Object.keys(option)[0];
    this.createRows[rownumber].vendor_email = (option.value || '').replace(/(?:\r\n|,)/g, '\n');
    this.closeDropdown();
  }
  showSubMenu(key: string) { this.hoveredKey = key; }
  hideSubMenu() { this.hoveredKey = null; }
  getSubMenuItems(key: string) {
    const subMenuData = this.branchVendorMappingDetailsData?.[key] ?? [];
    if (Array.isArray(subMenuData)) {
      return subMenuData.map((item: any) => {
        const label = Object.keys(item)[0];
        const value = item[label];
        return { label, value };
      });
    }
    return [];
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: Event) {
    const target = event.target as HTMLElement;
    if (!target.closest('.custom-dropdown')) {
      this.closeDropdown();
    }
  }

  // Helper used from template: returns keys of an object in stable order
  objectKeys(obj: any): string[] {
    if (!obj || typeof obj !== 'object') return [];
    return Object.keys(obj);
  }
}

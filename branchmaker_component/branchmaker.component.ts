import { Component, OnInit } from '@angular/core';
import { AuthenticationService } from '../authentication.service';
import { ApplicationsService } from '../applications.service';

@Component({
  selector: 'app-branchmaker',
  templateUrl: './branchmaker.component.html',
  styleUrls: ['./branchmaker.component.css']
})
export class BranchmakerComponent implements OnInit {

  months: string[] = [
    'January','February','March','April','May','June',
    'July','August','September','October','November','December'
  ];

  vendorType: any[] = [];
  vendorPayment: any = {};
  response: any = {};
  requestError = '';

  selectedYear: number = new Date().getFullYear();
  years: number[] = Array.from({ length: 5 }, (_, i) => this.selectedYear - i);

  constructor(
    private api: ApplicationsService,
    private auth: AuthenticationService
  ) {}

  ngOnInit(): void {
    this.loadMetadata();
  }

  loadMetadata() {
    this.requestError = '';
    const name = this.auth.getFcnName?.();
    const id = this.auth.getFcnEmpid?.();

    this.api.getMetadata(name, id).subscribe({
      next: (res:any) => {
        this.vendorType = res?.vendorPaymentTypes ?? [];
        this.vendorPayment = res?.vendorPayments ?? {};
      },
      error: () => this.requestError = 'Failed to load metadata'
    });
  }

  loadPayments() {
    const branch = this.auth.getFcnBcode?.();
    const bname = this.auth.getFcnBname?.();
    const uname = this.auth.getFcnName?.();
    const cid = this.auth.getFcnEmpid?.();

    if (!branch || !bname) {
      this.requestError = 'User/branch information missing';
      return;
    }

    this.api.getPaymentData(branch, bname, uname, cid, this.selectedYear).subscribe({
      next: (data:any) => { this.response = data ?? {}; },
      error: () => this.requestError = 'Failed to fetch data'
    });
  }

  trackByIndex(i:number) { return i; }
}

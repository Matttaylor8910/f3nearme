import {HttpClient} from '@angular/common/http';
import {Injectable} from '@angular/core';
import {take} from 'rxjs/operators';

@Injectable({providedIn: 'root'})
export class HttpService {
  constructor(
      private readonly http: HttpClient,
  ) {}

  /**
   * Hit the given data and return the response
   * @param url
   * @returns
   */
  get(url: string): Promise<any> {
    return new Promise(resolve => {
      this.http.get(url).pipe(take(1)).subscribe(data => {
        resolve(data);
      });
    });
  }
}

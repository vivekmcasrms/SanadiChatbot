import { describe, expect, it } from "vitest";
import { evaluateHostelEligibility, isHostelIntent } from "./rules";
describe("verified hostel rules", () => {
  it("Abu Dhabi, 75 credits receives single in A", () => {
    expect(evaluateHostelEligibility("Abu Dhabi",75)).toMatchObject({eligible:true,roomType:"single",hostels:["A"]});
  });
  it("Dubai, 59 credits receives double in B or C", () => {
    expect(evaluateHostelEligibility("Dubai",59)).toMatchObject({eligible:true,roomType:"double",hostels:["B","C"]});
  });
  it.each(["Al Ain","Al-Ain","العين"])("%s at 90 credits is ineligible", (city) => {
    expect(evaluateHostelEligibility(city,90)).toMatchObject({eligible:false,reason:"al_ain",roomType:null});
  });
  it("Sharjah at exactly 60 credits receives single in A", () => {
    expect(evaluateHostelEligibility("Sharjah",60)).toMatchObject({eligible:true,roomType:"single",hostels:["A"]});
  });
  it("missing city never permits submission", () => {expect(evaluateHostelEligibility(null,75).eligible).toBe(false);});
  it("missing credits never determines room type", () => {expect(evaluateHostelEligibility("Dubai",null).roomType).toBeNull();});
  it("recognises Arabic housing but leaves bus complaints alone", () => {
    expect(isHostelIntent("أريد غرفة في السكن")).toBe(true);
    expect(isHostelIntent("I want to complain about the hostel bus")).toBe(false);
  });
  it("a bare room request is housing, never a meeting", () => {
    expect(isHostelIntent("can I book a room")).toBe(true);
    expect(isHostelIntent("I want to book a room")).toBe(true);
    expect(isHostelIntent("I need a room please")).toBe(true);
    expect(isHostelIntent("احجز لي غرفة")).toBe(true);
    expect(isHostelIntent("أبغي غرفة")).toBe(true);
    expect(isHostelIntent("book a meeting room")).toBe(false);
    expect(isHostelIntent("I want to cancel my appointment")).toBe(false);
  });
});
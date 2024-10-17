---
title: MotherDuck data
queries:
  - complaints: complaints.sql
---

<BarChart 
    data={complaints}
    x=Year
    y=Complaints
/>

```sql complaints_details
select year(created_date)::int as Year, complaint_type as Type, count(*)::int as Complaints
        from sample_data.nyc.service_requests
        where Year < 2023
        and agency_name = 'New York City Police Department'
        group by 1, 2
        order by 1, 3 desc
```

<DataTable data={complaints_details} />
